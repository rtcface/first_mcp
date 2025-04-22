# MCP MongoDB Server

This server implements a Model Context Protocol (MCP) interface for MongoDB, allowing interaction with MongoDB collections and documents through standardized MCP requests.

## Features

### Resource Management

- **List Collections**: Lists all MongoDB collections as MCP resources
  - Each collection is represented with a `mongodb://` URI scheme
  - Returns collection names and metadata in MCP resource format

### Document Operations

- **Read Documents**: Retrieve documents from MongoDB collections
  - Access collections using `mongodb://collection-name` URI format
  - Supports filtering and projection of documents
  - Default limit of 100 documents per request

### Tools

- **Query Builder**: Structured querying of MongoDB collections
  - Specify collection name
  - Apply filters and projections
  - Configure result limits

### Security & Logging

- Secure MongoDB connection handling
- Detailed operation logging to `logs/server.log`
- Connection error handling and reporting
- Input validation for collection names and queries

### Configuration

- MongoDB connection via environment variables (`MONGODB_URI`)
- Configurable client options for performance and security
- Logging system with timestamp and error tracking

## Technical Details

- Built with `@modelcontextprotocol/sdk` version 1.10.2
- Uses MongoDB Node.js driver version 6.16.0
- Implements MCP server capabilities for resources and tools

## Components

### Tools

- **query**
  - Execute MongoDB queries with filtering and projection
  - Input parameters:
    - `collection`: Name of collection to query
    - `filter`: MongoDB query filter (optional)
    - `projection`: Fields to include/exclude (optional)
    - `limit`: Maximum number of documents to return (default 100)

### Resources

The server provides access to MongoDB collections as resources:

- **Collections** (`mongodb://<collection-name>`)
  - Each collection is exposed as a resource
  - Documents are returned in JSON format
  - Supports filtering and projection via query tool

## Configuration

### Usage with Claude Desktop

To use this server with Claude Desktop, add the following to your `claude_desktop_config.json`:
