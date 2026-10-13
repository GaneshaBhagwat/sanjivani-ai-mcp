
import "dotenv/config";
import pg from "pg";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const { Pool } = pg;

const db = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

const server = new McpServer({
  name: "sanjivani-farmer-server",
  version: "1.0.0"
});

// Register exactly one MCP tool
server.tool(
  "get_farmer_data",
  {},
  async () => {
    try {
      const result = await db.query(`
        SELECT farmer_id, name, village,
               sugarcane_tons, payment_pending, amount_paid
        FROM farmers
        ORDER BY farmer_id
      `);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.rows)
          }
        ]
      };
    } catch (error) {
      console.error("Database error:", error);

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Could not retrieve farmer data from PostgreSQL."
          }
        ]
      };
    }
  }
);

const transport = new StdioServerTransport();

await server.connect(transport);
console.error("Sanjivani Farmer MCP Server is running.");

