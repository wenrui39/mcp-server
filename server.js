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
app.use(cors());

// 日志中间件
app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.url}`);
  next();
});

// 健康检查
app.get('/', (req, res) => {
  res.send('✅ MCP Server is RUNNING! Please use /sse endpoint in n8n.');
});

// 🌟 核心修复：声明一个全局变量保存连接通道
let activeTransport = null;

// 1. n8n 建立 SSE 连接 (GET 请求)
app.get('/sse', async (req, res) => {
  console.log('✅ New SSE Connection established!');
  // 告诉 n8n 将消息发到 /messages
  activeTransport = new SSEServerTransport('/messages', res);
  await server.connect(activeTransport);
});

// 2. 接收 n8n 发来的标准对话消息
app.post('/messages', async (req, res) => {
  console.log('📩 Message received on /messages');
  if (activeTransport) {
    await activeTransport.handlePostMessage(req, res); // 必须用这个方法
  } else {
    res.status(400).send('No active SSE connection');
  }
});

// 3. 兜底方案：如果 n8n 强行把消息发到 /sse，我们也接住它！
app.post('/sse', async (req, res) => {
  console.log('📩 Message received on /sse (Fallback)');
  if (activeTransport) {
    await activeTransport.handlePostMessage(req, res); // 必须用这个方法
  } else {
    res.status(400).send('No active SSE connection');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
