import { ApolloServer, gql } from "apollo-server-micro";

const SECRET_API_KEY = process.env.SECRET_API_KEY; // Store this in Vercel Environment Variables

// Define the GraphQL schema
const typeDefs = gql`
  type Mutation {
    fileChanged(diff: String!): String
  }

  type Query {
    _empty: String
  }
`;

// Define the resolvers
const resolvers = {
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
  Query: {
    _empty: () => "Hello, world!",
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
