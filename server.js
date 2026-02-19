import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import cors from 'cors';
import playwright from 'playwright-extra';
const chromium = playwright.chromium;
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const server = new McpServer({
  name: "StealthBrowser",
  version: "1.0.0",
});

server.tool(
  "stealth_browse",
  "Visit a webpage using a stealth browser to bypass Cloudflare.",
  {
    url: z.string().url().describe("The URL to visit"),
    waitFor: z.number().optional().describe("Seconds to wait (default: 5)"),
  },
  async ({ url, waitFor = 5 }) => {
    // 抓取逻辑保持不变
    let browser;
    try {
      browser = await chromium.launch({
        headless: process.env.HEADLESS !== 'false',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
        proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined
      });
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(waitFor * 1000);
      const content = await page.content();
      const title = await page.title();
      return { content: [{ type: "text", text: `Title: ${title}\n\nHTML Content:\n${content}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    } finally {
      if (browser) await browser.close();
    }
  }
);

const app = express();
app.use(cors());
app.use(express.json()); // 关键：确保能解析 n8n 发来的 JSON POST 请求

// 🌟 1. 首页健康检查 (验证代码是否更新的唯一标准)
app.get('/', (req, res) => {
  res.send('🟢 V3 ONLINE: MCP Server is RUNNING!');
});

let activeTransport = null;

// 🌟 2. 建立 SSE 通道
app.get('/sse', async (req, res) => {
  console.log('🔗 [GET /sse] n8n is trying to connect...');
  
  // Render 黑魔法：强制 Nginx 代理不缓存数据流
  res.setHeader('X-Accel-Buffering', 'no');
  
  // 告诉 n8n 将指令发送到 /messages 路径
  activeTransport = new SSEServerTransport('/messages', res);
  await server.connect(activeTransport);
});

// 🌟 3. 接收 n8n 的指令
app.post('/messages', async (req, res) => {
  console.log('📩 [POST /messages] n8n sent a command');
  if (activeTransport) {
    await activeTransport.handlePostMessage(req, res);
  } else {
    res.status(400).send('No active connection');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
