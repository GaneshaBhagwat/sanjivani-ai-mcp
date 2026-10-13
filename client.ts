
import "dotenv/config";
import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Your question is hardcoded here
const question =
  "Identify farmers who have supplied more than 100 tons of sugarcane but still have pending payments above ₹40,000. Rank them by pending payment, from highest to lowest.";

const mcp = new Client({
  name: "sanjivani-farmer-client",
  version: "1.0.0"
});

// The client automatically starts server.ts
const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "server.ts"]
});

try {
  await mcp.connect(transport);

  // Discover the tools registered by the MCP server
  const { tools } = await mcp.listTools();

  const tool = tools.find(t => t.name === "get_farmer_data");

  if (!tool) {
    throw new Error("get_farmer_data tool was not found.");
  }

  // Give the discovered tool to OpenAI
  const response = await openai.responses.create({
    model: "gpt-5.5",
    instructions:
      "You are a sugar factory data assistant. Answer using the supplied database results only. Calculate totals carefully. Do not invent farmer records.",
    input: question,
    tools: [
      {
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema as Record<string, unknown>,
        strict: false
      }
    ],
    tool_choice: "auto"
  });

  // Handle the tool call requested by OpenAI
  for (const item of response.output) {
    if (item.type !== "function_call") continue;

    if (item.name !== "get_farmer_data") {
      throw new Error(`Unexpected tool call: ${item.name}`);
    }

    // Execute the actual MCP tool
    const result = await mcp.callTool({
      name: item.name,
      arguments: JSON.parse(item.arguments)
    });

const content = result.content as Array<{
  type: string;
  text?: string;
}>;

const farmerData = content
  .filter((part) => part.type === "text")
  .map((part) => part.text ?? "")
  .join("\n");


    // Send the database results back to OpenAI
    const finalResponse = await openai.responses.create({
      model: "gpt-5.5",
      instructions:
        "Answer the original question using only the database results. Show the farmer's name, village, sugarcane supplied, and total pending payment. Do not invent data.",
      input: [
        { role: "user", content: question },
        {
          role: "assistant",
          content: `The MCP tool returned these database results:\n${farmerData}`
        }
      ]
    });

    console.log("\nAI ANSWER:\n");
    console.log(finalResponse.output_text);
  }
} catch (error) {
  console.error("Application error:", error);
} finally {
  await mcp.close();
}