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
          prodChains = declaration.init.elements.map((element) => ({
            info: element.properties.find((prop) => prop.key.name === "info")
              .value.value,
            text: element.properties.find((prop) => prop.key.name === "text")
              .value.value,
            color: element.properties.find((prop) => prop.key.name === "color")
              .value.value,
            logo: element.properties.find((prop) => prop.key.name === "logo")
              .value.value,
            providers: element.properties
              .find((prop) => prop.key.name === "providers")
              .value.properties.map((provider) => ({
                name: provider.key.value,
                url: provider.value.value,
              })),
          }));
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
