#!/usr/bin/env node

// IMPORTANT: Set environment variables before any imports
process.env.MONGODB_LOG_LEVEL = "off";
process.env.MONGODB_DISABLE_LOGGING = "true";
process.env.DEBUG = "";
process.env.MONGODB_DEBUG = "false";
process.env.NODE_DEBUG = "";

// CRITICAL: Immediately intercept stdout/stderr before any other operations
// Save original stdout/stderr write functions to use only for MCP messages
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

// Create a flag to control when to use original stdout
let useMcpStdio = false;

// Override stdout/stderr to prevent any non-MCP output
process.stdout.write = function (
  chunk: any,
  encoding?: any,
  callback?: any
): boolean {
  // Only use original stdout when explicitly enabled for MCP
  if (useMcpStdio) {
    return originalStdoutWrite(chunk, encoding, callback);
  }

  // Otherwise silently capture all output to prevent interference
  if (typeof callback === "function") {
    callback();
  }
  return true;
};

process.stderr.write = function (
  chunk: any,
  encoding?: any,
  callback?: any
): boolean {
  // Always redirect stderr to prevent interference
  if (typeof callback === "function") {
    callback();
  }
  return true;
};

// Disable all console output to prevent interfering with MCP communication
const noopConsole = {
  log: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  assert: () => {},
  clear: () => {},
  count: () => {},
  countReset: () => {},
  dir: () => {},
  dirxml: () => {},
  group: () => {},
  groupCollapsed: () => {},
  groupEnd: () => {},
  table: () => {},
  time: () => {},
  timeEnd: () => {},
  timeLog: () => {},
  timeStamp: () => {},
  profile: () => {},
  profileEnd: () => {},
};

// Save original console for emergency outputs to file
const originalConsole = { ...console };

// Replace console with noop implementation
console = noopConsole as Console;

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MongoClient, MongoClientOptions } from "mongodb";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

// Create a logging directory
const logDir = path.join(process.cwd(), "logs");
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
} catch (e) {
  // Ignore errors
}

// Simple file logger
function logToFile(message: string): void {
  try {
    fs.appendFileSync(
      path.join(logDir, "server.log"),
      `${new Date().toISOString()} ${message}\n`
    );
  } catch (e) {
    // Ignore errors
  }
}

// Basic schemas
const ResourceSchema = z.object({
  uri: z.string(),
  mimeType: z.string(),
  name: z.string(),
});

const QueryInputSchema = z.object({
  collection: z.string(),
  filter: z.record(z.any()).optional().default({}),
  projection: z.record(z.any()).optional().default({}),
  limit: z.number().optional().default(100),
});

// Complete MongoDB client options
const mongoClientOptions: MongoClientOptions = {
  // Disable monitoring events
  monitorCommands: false,

  // Use direct connection to avoid SRV lookup logs
  directConnection: false,

  // Connection timeouts
  connectTimeoutMS: 50000,
  socketTimeoutMS: 30000,

  // Disable server discovery logging
  serverSelectionTimeoutMS: 50000,

  // Disable driver events and logging
  ignoreUndefined: true,

  // Disable all automatic retry logging
  retryWrites: false,
  retryReads: false,
};

const args = process.argv;

if (args.length === 0) {
  throw new Error("Please provide a database URL as a command-line argument");
}

// MongoDB setup (don't connect yet)
const uri = JSON.stringify(args[2], null, 2);
logToFile("Uri in args " + uri);

const mongoUrl = uri || "mongodb://localhost:27017";
let client: MongoClient | null = null;

// Create MCP server
const server = new Server(
  {
    name: "example-servers/mongodb",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// Helper to validate collection names
function validateCollectionName(name: string): string {
  if (!name || name.includes("$") || name.startsWith("system.")) {
    throw new Error(`Invalid collection name: ${name}`);
  }
  return name;
}

// Safe MongoDB operation wrapper
async function safeOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logToFile(`MongoDB operation error: ${(error as Error).message}`);
    throw error;
  }
}

// Async MongoDB connection function with complete logging suppression
async function connectToMongoDB(): Promise<void> {
  if (!client) {
    // Force disable any logging that might occur during connection
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleInfo = console.info;

    // Completely disable console methods temporarily
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    console.info = () => {};

    try {
      // Override process.stdout/stderr write functions to completely swallow output
      const tempStdoutWrite = process.stdout.write;
      const tempStderrWrite = process.stderr.write;

      process.stdout.write = () => true;
      process.stderr.write = () => true;

      try {
        // Create client with all logging disabled
        client = new MongoClient(mongoUrl, mongoClientOptions);

        // Connect with all logging suppressed
        await client.connect();
        logToFile("Successfully connected to MongoDB");
      } finally {
        // Restore process.stdout/stderr functions
        process.stdout.write = tempStdoutWrite;
        process.stderr.write = tempStderrWrite;
      }
    } catch (error) {
      logToFile(`Failed to connect to MongoDB: ${(error as Error).message}`);
      throw error;
    } finally {
      // Restore console methods
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      console.info = originalConsoleInfo;
    }
  }
}

// Add request handlers to the server

// List collections as resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    // Temporarily disable MCP stdout to prevent any connection logs
    const originalMcpStdio = useMcpStdio;
    useMcpStdio = false;

    try {
      // Connect to MongoDB if not connected
      await connectToMongoDB();

      // Get collections
      const collections = await safeOperation(() =>
        client!.db().listCollections().toArray()
      );

      // Re-enable MCP stdout
      useMcpStdio = originalMcpStdio;

      // Map collections to resources
      return {
        resources: collections.map((collection) => ({
          uri: `mongodb://${collection.name}`,
          mimeType: "application/json",
          name: `${collection.name} collection`,
        })),
      };
    } finally {
      // Ensure MCP stdout is restored even if there's an error
      useMcpStdio = originalMcpStdio;
    }
  } catch (error) {
    logToFile(`List resources error: ${(error as Error).message}`);
    // Return error in MCP-compatible format
    return {
      resources: [],
      error: `Failed to list MongoDB collections: ${(error as Error).message}`,
    };
  }
});

// Read documents from a collection
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  try {
    // Temporarily disable MCP stdout to prevent any connection logs
    const originalMcpStdio = useMcpStdio;
    useMcpStdio = false;

    try {
      // Connect to MongoDB if not connected
      await connectToMongoDB();

      // Parse the URI to get collection name
      let collectionName = "";
      try {
        const url = new URL(request.params.uri);
        collectionName = url.pathname.slice(1);
      } catch (err) {
        // Handle case where URI is not a valid URL
        collectionName = request.params.uri.replace("mongodb://", "");
      }

      if (!collectionName) {
        throw new Error("Invalid resource URI: collection name is required");
      }

      // Validate and get documents
      const safeName = validateCollectionName(collectionName);
      const documents = await safeOperation(() =>
        client!.db().collection(safeName).find().limit(10).toArray()
      );

      // Re-enable MCP stdout before returning response
      useMcpStdio = originalMcpStdio;

      // Return documents as JSON text
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(documents, null, 2),
          },
        ],
      };
    } finally {
      // Ensure MCP stdout is restored even if there's an error
      useMcpStdio = originalMcpStdio;
    }
  } catch (error) {
    logToFile(`Read resource error: ${(error as Error).message}`);
    // Return error in MCP-compatible format
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/plain",
          text: `Error: Failed to read MongoDB resource: ${
            (error as Error).message
          }`,
        },
      ],
    };
  }
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "query",
        description: "Run a MongoDB query",
        inputSchema: {
          type: "object",
          properties: {
            collection: { type: "string" },
            filter: { type: "object" },
            projection: { type: "object" },
            limit: { type: "number" },
          },
          required: ["collection"],
        },
      },
    ],
  };
});

// Execute MongoDB queries
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    // Temporarily disable MCP stdout to prevent any connection logs
    const originalMcpStdio = useMcpStdio;
    useMcpStdio = false;

    try {
      // Verify the tool name
      if (request.params.name !== "query") {
        // Re-enable MCP stdout
        useMcpStdio = originalMcpStdio;
        return {
          contents: [
            {
              uri: `mongodb://tool/${request.params.name}`,
              mimeType: "text/plain",
              text: `Error: Unknown tool: ${request.params.name}`,
            },
          ],
        };
      }

      // Connect to MongoDB if not connected
      await connectToMongoDB();

      // Parse and validate arguments
      const parsedArgs = QueryInputSchema.parse(request.params.arguments);
      const { collection, filter, projection, limit } = parsedArgs;

      // Validate collection name
      const safeName = validateCollectionName(collection);

      // Execute query
      const result = await safeOperation(() =>
        client!
          .db()
          .collection(safeName)
          .find(filter, { projection })
          .limit(limit)
          .toArray()
      );

      // Re-enable MCP stdout
      useMcpStdio = originalMcpStdio;
      console.log(result);
      // Return results
      return {
        contents: [
          {
            uri: `mongodb://query/${parsedArgs.collection}`,
            mimeType: "application/json",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } finally {
      // Ensure MCP stdout is restored even if there's an error
      useMcpStdio = originalMcpStdio;
    }
  } catch (error) {
    logToFile(`Call tool error: ${(error as Error).message}`);
    return {
      contents: [
        {
          uri: `mongodb://query/${
            request.params.arguments?.collection || "unknown"
          }`,
          mimeType: "text/plain",
          text: `Error: ${(error as Error).message}`,
        },
      ],
    };
  }
});

// Server initialization and shutdown handling
async function runServer() {
  try {
    // Initialize MongoDB first before enabling any stdout
    // This ensures MongoDB setup won't interfere with MCP protocol
    useMcpStdio = false;
    logToFile("Startup: Initializing server with stdout disabled");

    // Pre-connect to MongoDB to ensure it doesn't log during MCP setup
    try {
      logToFile("Startup: Pre-connecting to MongoDB...");
      await connectToMongoDB();
      logToFile("Startup: MongoDB pre-connection successful");
    } catch (mongoError) {
      logToFile(
        `Startup warning: MongoDB pre-connection failed: ${
          (mongoError as Error).message
        }`
      );
      // Continue without MongoDB - we'll try again when needed
    }

    // CRITICAL: Create the transport while stdout is still disabled
    logToFile("Startup: Creating StdioServerTransport...");
    const transport = new StdioServerTransport();

    // Override stdout implementation at the lowest level possible
    // This ensures no leaking of logs during connection
    process.stdout.write = function (
      chunk: any,
      encoding?: any,
      callback?: any
    ): boolean {
      if (useMcpStdio) {
        return originalStdoutWrite(chunk, encoding, callback);
      }
      if (typeof callback === "function") {
        callback();
      }
      return true;
    };

    // NOW enable MCP stdout immediately before server.connect
    logToFile("Startup: Enabling MCP JSON communication");
    useMcpStdio = true;

    // Connect to transport with stdout enabled
    try {
      logToFile("Startup: Connecting to transport...");
      await server.connect(transport);
      logToFile("Startup: MCP server connected to transport successfully");
    } catch (connectionError) {
      // If connection fails, disable stdout and log the error
      useMcpStdio = false;
      logToFile(
        `Startup error: Transport connection failed: ${
          (connectionError as Error).message
        }`
      );
      throw connectionError;
    }

    // MongoDB is already initialized, and MCP is established
    // The server is now fully initialized
    logToFile("Startup: Server fully initialized and ready");

    // Set up graceful shutdown
    setupGracefulShutdown();
  } catch (error) {
    logToFile(`Failed to start server: ${(error as Error).message}`);
    await cleanup();
    process.exit(1);
  }
}

// Set up graceful shutdown handlers
function setupGracefulShutdown() {
  const signals = ["SIGINT", "SIGTERM", "SIGQUIT"] as const;

  for (const signal of signals) {
    process.on(signal, async () => {
      logToFile(`Received ${signal}, shutting down...`);
      await cleanup();
      process.exit(0);
    });
  }

  process.on("unhandledRejection", (reason) => {
    logToFile(`Unhandled Promise Rejection: ${reason}`);
  });

  process.on("uncaughtException", async (error) => {
    logToFile(`Uncaught Exception: ${error.message}`);
    await cleanup();
    process.exit(1);
  });
}

// Cleanup resources
async function cleanup() {
  try {
    // Make sure we're not using MCP stdout during cleanup
    useMcpStdio = false;

    if (client) {
      logToFile("Closing MongoDB connection...");
      await client.close();
      client = null;
      logToFile("MongoDB connection closed");
    }
  } catch (error) {
    logToFile(`Error during cleanup: ${(error as Error).message}`);
  }
}

// Start the server
runServer().catch((error) => {
  logToFile(`Unhandled error in runServer: ${error.message}`);
  cleanup().then(() => process.exit(1));
});
