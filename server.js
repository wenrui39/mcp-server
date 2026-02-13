import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import cors from 'cors';
import playwright from 'playwright-extra';
const chromium = playwright.chromium;
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// 启用隐身插件
chromium.use(StealthPlugin());

// 初始化 MCP 服务器
const server = new McpServer({
  name: "StealthBrowser",
  version: "1.0.0",
});

// 定义工具
server.tool(
  "stealth_browse",
  "Visit a webpage using a stealth browser to bypass Cloudflare.",
  {
    url: z.string().url().describe("The URL to visit"),
    waitFor: z.number().optional().describe("Seconds to wait (default: 5)"),
  },
  async ({ url, waitFor = 5 }) => {
    console.log(`[Job] Starting visit to: ${url}`);
    let browser;
    try {
      console.log('[Job] Launching browser...');
      browser = await chromium.launch({
        headless: process.env.HEADLESS !== 'false',
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox', 
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars'
        ],
        proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined
      });
      
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

      console.log('[Job] Navigating...');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      console.log(`[Job] Waiting ${waitFor}s...`);
      await page.waitForTimeout(waitFor * 1000);
      
      const content = await page.content();
      const title = await page.title();
      console.log(`[Job] Success! Title: ${title}`);
      
      return { content: [{ type: "text", text: `Title: ${title}\n\nHTML Content:\n${content}` }] };
    } catch (error) {
      console.error('[Job] Error:', error.message);
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    } finally {
      if (browser) await browser.close();
    }
  }
);

const app = express();
app.use(cors()); // 允许跨域

// ✅ 新增：请求日志中间件 (方便调试)
app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.url}`);
  next();
});

// ✅ 新增：健康检查 (解决你的 404 问题)
app.get('/', (req, res) => {
  res.send('✅ MCP Server is RUNNING! Please use /sse endpoint in n8n.');
});

// SSE 端点
app.get('/sse', async (req, res) => {
  console.log('✅ New SSE Connection detected!');
  const transport = new SSEServerTransport('/messages', res);
  await server.connect(transport);
});

// 消息处理端点
app.post('/messages', async (req, res) => {
  console.log('📩 Message received via POST');
  await server.connect(new SSEServerTransport('/messages', res));
  // 这里的处理逻辑由 SDK 接管，我们只需透传
});

// Render 会自动分配 PORT，如果本地运行则用 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
