import { ApolloServer, gql } from "apollo-server-micro";
import fetch from "node-fetch";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as babelTypes from "@babel/types";

const SECRET_API_KEY = process.env.SECRET_API_KEY; // Store this in Vercel Environment Variables
const GITHUB_FILE_URL =
  "https://raw.githubusercontent.com/polkadot-js/apps/359e8b48d19bad1165e028a4391df4f748385279/packages/apps-config/src/endpoints/production.ts";

// Define the GraphQL schema
const typeDefs = gql`
  type Chain {
    info: String
    text: String
    color: String
    logo: String
    providers: [Provider]
  }

  type Provider {
    name: String
    url: String
  }

  type Query {
    chains: [Chain]
  }

  type Mutation {
    fileChanged(diff: String!): String
  }
`;

// Fetch and parse the file content
const fetchFileContent = async () => {
  const response = await fetch(GITHUB_FILE_URL);
  const fileContent = await response.text();
  return fileContent;
};

const parseProdChains = (fileContent) => {
  const ast = parse(fileContent, {
    sourceType: "module",
    plugins: ["typescript"],
  });

  let prodChains = [];

  traverse(ast, {
    ExportNamedDeclaration(path) {
      if (
        path.node.declaration &&
        babelTypes.isVariableDeclaration(path.node.declaration)
      ) {
        const declaration = path.node.declaration.declarations[0];
        if (babelTypes.isIdentifier(declaration.id, { name: "prodChains" })) {
          prodChains = declaration.init.elements.map((element) => {
            const infoProp = element.properties.find(
              (prop) => prop.key.name === "info"
            );
            const textProp = element.properties.find(
              (prop) => prop.key.name === "text"
            );
            const colorProp = element.properties.find(
              (prop) => prop.key.name === "color"
            );
            const logoProp = element.properties.find(
              (prop) => prop.key.name === "logo"
            );
            const providersProp = element.properties.find(
              (prop) => prop.key.name === "providers"
            );

            return {
              info: infoProp?.value?.value || null,
              text: textProp?.value?.value || null,
              color: colorProp?.value?.value || null,
              logo: logoProp?.value?.value || null,
              providers: providersProp
                ? providersProp.value.properties.map((provider) => ({
                    name: provider.key?.value || provider.key?.name || null,
                    url: provider.value?.value || null,
                  }))
                : [],
            };
          });
        }
      }
    },
  });

  return prodChains;
};

// Define the resolvers
const resolvers = {
  Query: {
    chains: async () => {
      const fileContent = await fetchFileContent();
      const prodChains = parseProdChains(fileContent);
      return prodChains;
    },
  },
  Mutation: {
    fileChanged: async (_, { diff }, context) => {
      if (!context.isAuthorized) {
        throw new Error("Unauthorized");
      }
      console.log("File changed:", diff);
      // Here, you can handle the diff as needed, e.g., store in a database, send a notification, etc.
      return "File change processed";
    },
  },
};

// Create the Apollo Server
const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
  playground: true,
  context: ({ req }) => {
    const token = req.headers.authorization || "";
    const isAuthorized = token === `Bearer ${SECRET_API_KEY}`;
    return { isAuthorized };
  },
});

export const config = {
  api: {
    bodyParser: false,
  },
};

export default server.createHandler({ path: "/api/graphql" });
