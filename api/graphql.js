import { ApolloServer, gql } from "apollo-server-micro";
import fetch from "node-fetch";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as babelTypes from "@babel/types";

const SECRET_API_KEY = process.env.SECRET_API_KEY; // Store this in Vercel Environment Variables
const GITHUB_FILE_URL =
  "https://raw.githubusercontent.com/polkadot-js/apps/359e8b48d19bad1165e028a4391df4f748385279/packages/apps-config/src/endpoints/production.ts";
const GITHUB_LOGO_BASE_URL =
  "https://raw.githubusercontent.com/polkadot-js/apps/359e8b48d19bad1165e028a4391df4f748385279/packages/apps-config/src/ui/logos/chains/generated/";

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

// Fetch file content from GitHub
const fetchFileContent = async (url) => {
  const response = await fetch(url);
  const fileContent = await response.text();
  return fileContent;
};

// Fetch logo content dynamically
const fetchLogos = async (logoFiles) => {
  const logoData = {};

  for (const [importName, fileName] of Object.entries(logoFiles)) {
    const response = await fetch(`${GITHUB_LOGO_BASE_URL}${fileName}`);
    const logoContent = await response.text();
    logoData[importName] = logoContent;
  }

  return logoData;
};

// Parse `production.ts` file to get the logo import names and file names
const getLogoFilesFromProduction = (fileContent) => {
  const ast = parse(fileContent, {
    sourceType: "module",
    plugins: ["typescript"],
  });
  const logoFiles = {};

  traverse(ast, {
    ImportDeclaration(path) {
      if (path.node.source.value.includes("/chains/generated")) {
        path.node.specifiers.forEach((specifier) => {
          const importName = specifier.local.name;
          const fileName = path.node.source.value.split("/").pop();
          logoFiles[importName] = `${fileName}.ts`;
        });
      }
    },
  });

  return logoFiles;
};

const parseProdChains = (fileContent, logos) => {
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
            const uiProp = element.properties.find(
              (prop) => prop.key.name === "ui"
            );
            const providersProp = element.properties.find(
              (prop) => prop.key.name === "providers"
            );

            let color = null;
            let logo = null;

            if (uiProp) {
              const colorProp = uiProp.value.properties.find(
                (prop) => prop.key.name === "color"
              );
              const logoProp = uiProp.value.properties.find(
                (prop) => prop.key.name === "logo"
              );
              color = colorProp?.value?.value || null;
              logo = logoProp?.value?.name ? logos[logoProp.value.name] : null;
            }

            return {
              info: infoProp?.value?.value || null,
              text: textProp?.value?.value || null,
              color,
              logo,
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
      const fileContent = await fetchFileContent(GITHUB_FILE_URL);
      const logoFiles = getLogoFilesFromProduction(fileContent);
      const logos = await fetchLogos(logoFiles);
      const prodChains = parseProdChains(fileContent, logos);
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
