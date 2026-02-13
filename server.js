import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import cors from 'cors';

// Playwright Extra 和 Stealth 插件的 ESM 导入写法
import playwright from 'playwright-extra';
const chromium = playwright.chromium; // 直接获取 chromium 对象
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// 1. 启用隐身模式
chromium.use(StealthPlugin());

// 2. 初始化 MCP 服务器
const server = new McpServer({
  name: "StealthBrowser",
  version: "1.0.0",
});

// 3. 定义工具: stealth_browse
server.tool(
  "stealth_browse",
  "Visit a webpage using a stealth browser to bypass anti-bot protections (Cloudflare).",
  {
    url: z.string().url().describe("The URL to visit"),
    waitFor: z.number().optional().describe("Seconds to wait for Cloudflare challenge (default: 5)"),
  },
  async ({ url, waitFor = 5 }) => {
    console.log(`[Stealth] Visiting: ${url}`);
    let browser;
    try {
      browser = await chromium.launch({
        headless: process.env.HEADLESS !== 'false',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars'
        ],
        // 读取代理配置
        proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined
      });

      const page = await browser.newPage();
      
      // 额外的伪装头
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Upgrade-Insecure-Requests': '1'
      });

      // 访问页面
      console.log("[Stealth] Navigating...");
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // 等待过盾
      console.log(`[Stealth] Waiting ${waitFor}s for challenges...`);
      await page.waitForTimeout(waitFor * 1000);

      // 检查标题
      const title = await page.title();
      if (title.includes("Just a moment") || title.includes("Cloudflare")) {
          console.log("[Stealth] Challenge detected, waiting 5s more...");
          await page.waitForTimeout(5000);
      }

      const content = await page.content();
      const finalTitle = await page.title();
      console.log(`[Stealth] Success! Title: ${finalTitle}`);
      
      return {
        content: [{ type: "text", text: `Title: ${finalTitle}\n\nHTML Content:\n${content}` }],
      };

    } catch (error) {
      console.error("[Stealth] Error:", error);
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    } finally {
      if (browser) await browser.close();
    }
  }
);

const app = express();
app.use(cors());

app.get('/sse', async (req, res) => {
  console.log("New SSE connection established");
  const transport = new SSEServerTransport('/messages', res);
  await server.connect(transport);
});


app.post('/messages', async (req, res) => {
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000; 
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Stealth MCP Server running on port ${PORT} (SSE mode)`);
});
