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

// 请求日志中间件
app.use((req, res, next) => {
  // 过滤掉烦人的 favicon 请求
  if (req.url !== '/favicon.ico') {
    console.log(`[Request] ${req.method} ${req.url}`);
  }
  next();
});

// 健康检查
app.get('/', (req, res) => {
  res.send('✅ MCP Server is RUNNING!');
});

// 🌟 核心通道变量
let activeTransport = null;

// 1. 建立 SSE 连接 (n8n 必须先调用这个)
app.get('/sse', async (req, res) => {
  console.log('✅ n8n is attempting to connect to SSE...');

  // Critical headers for Render and SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Render proxy buffering

  activeTransport = new SSEServerTransport('/sse', res);
  
  try {
    await server.connect(activeTransport);
    console.log('🚀 MCP Server connected to transport');
  } catch (err) {
    console.error('❌ Connection error:', err);
  }

  // Handle client disconnect
  req.on('close', () => {
    console.log('🔌 Client closed SSE connection');
    activeTransport = null;
  });
});

// 2. Receiving POST messages
app.post('/sse', async (req, res) => {
  if (activeTransport) {
    await activeTransport.handlePostMessage(req, res);
  } else {
    res.status(400).send('No active SSE connection');
  }
});

// Use Render's preferred port
const PORT = process.env.PORT || 10000; 
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
