const { ApolloServer, gql } = require("apollo-server-micro");
const {
  ApolloServerPluginLandingPageGraphQLPlayground,
} = require("apollo-server-core");
const express = require("express");
const fetch = require("node-fetch");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const babelTypes = require("@babel/types");

const GITHUB_POLKADOT_FILE_URL =
  "https://raw.githubusercontent.com/polkadot-js/apps/359e8b48d19bad1165e028a4391df4f748385279/packages/apps-config/src/endpoints/productionRelayPolkadot.ts";
const GITHUB_KUSAMA_FILE_URL =
  "https://raw.githubusercontent.com/polkadot-js/apps/359e8b48d19bad1165e028a4391df4f748385279/packages/apps-config/src/endpoints/productionRelayKusama.ts";
const GITHUB_LOGO_BASE_URL =
  "https://raw.githubusercontent.com/polkadot-js/apps/359e8b48d19bad1165e028a4391df4f748385279/packages/apps-config/src/ui/logos/chains/generated/";

const typeDefs = gql`
  type Chain {
    info: String
    text: String
    color: String
    logo: String
    providers: [Provider]
    network: String
  }

  type Provider {
    name: String
    url: String
  }

  type Query {
    chains(network: String): [Chain]
  }

  type Mutation {
    fileChanged(diff: String!): String
  }
`;

const fetchFileContent = async (url) => {
  const response = await fetch(url);
  const fileContent = await response.text();
  return fileContent;
};

const fetchLogos = async (logoFiles) => {
  const logoData = {};

  for (const [importName, fileName] of Object.entries(logoFiles)) {
    const response = await fetch(`${GITHUB_LOGO_BASE_URL}${fileName}`);
    const logoContent = await response.text();
    logoData[importName] = logoContent;
  }

  return logoData;
};

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

const parseChains = (fileContent, logos, network) => {
  const ast = parse(fileContent, {
    sourceType: "module",
    plugins: ["typescript"],
  });

  let chains = [];

  traverse(ast, {
    ExportNamedDeclaration(path) {
      if (
        path.node.declaration &&
        babelTypes.isVariableDeclaration(path.node.declaration)
      ) {
        const declaration = path.node.declaration.declarations[0];
        if (babelTypes.isIdentifier(declaration.id)) {
          chains = declaration.init.elements.map((element) => {
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
              network,
            };
          });
        }
      }
    },
  });

  return chains;
};

const resolvers = {
  Query: {
    chains: async (_, { network }) => {
      const [polkadotContent, kusamaContent] = await Promise.all([
        fetchFileContent(GITHUB_POLKADOT_FILE_URL),
        fetchFileContent(GITHUB_KUSAMA_FILE_URL),
      ]);

      const logoFilesPolkadot = getLogoFilesFromProduction(polkadotContent);
      const logoFilesKusama = getLogoFilesFromProduction(kusamaContent);
      const allLogoFiles = { ...logoFilesPolkadot, ...logoFilesKusama };
      const logos = await fetchLogos(allLogoFiles);

      const polkadotChains = parseChains(polkadotContent, logos, "polkadot");
      const kusamaChains = parseChains(kusamaContent, logos, "kusama");

      const allChains = [...polkadotChains, ...kusamaChains];

      if (network) {
        return allChains.filter((chain) => chain.network === network);
      }

      return allChains;
    },
  },
  Mutation: {
    fileChanged: async (_, { diff }, context) => {
      if (!context.isAuthorized) {
        throw new Error("Unauthorized");
      }
      console.log("File changed:", diff);
      return "File change processed";
    },
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
  plugins: [ApolloServerPluginLandingPageGraphQLPlayground()],
  context: ({ req }) => {
    const token = req.headers.authorization || "";
    const isAuthorized = token === `Bearer ${SECRET_API_KEY}`;
    return { isAuthorized };
  },
});

const app = express();
server.start().then(() => {
  server.applyMiddleware({ app, path: "/" });
  app.listen(3000, () => {
    console.log("Server is running on http://localhost:3000");
  });
});
