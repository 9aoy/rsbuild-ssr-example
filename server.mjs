import fs from "fs";
import path from "node:path";
import { createRequire } from 'node:module';
import { createRsbuild } from "@rsbuild/core";
import { loadConfig } from "@rsbuild/core";
import express from "express";

const require = createRequire(import.meta.url);

export const serverRender = async (_req, res, next) => {
  const remotesPath = path.join(process.cwd(), `./dist/server/index.js`);

  const importedApp = require(remotesPath);

  const markup = importedApp.render();

  const template = fs.readFileSync(`${process.cwd()}/dist/index.html`, "utf-8");

  const html = template.replace(`<!--app-content-->`, markup);

  res.status(200).set({ "Content-Type": "text/html" }).send(html);
};

const cleanSSRCache = (serverStats) => {
  const data = serverStats.toJson({
    all: false,
    assets: true,
    outputPath: true
  });

  const bundles = data.assets.filter(asset => !asset.name.endsWith('.map')).map(asset => path.join(data.outputPath, asset.name))

  bundles.forEach(filepath => {
    if (require.cache[filepath]) {
      delete require.cache[filepath];
    }
  });
};

async function startDevServer() {
  const { content } = await loadConfig({});

  const rsbuild = await createRsbuild({
    rsbuildConfig: content,
  });

  const app = express();

  let isFirstCompileDone = false;

  rsbuild.onDevCompileDone(({ stats }) => {
    const serverStats = stats.stats.filter(s => s.compilation.name === 'Server')[0];

    cleanSSRCache(serverStats);

    isFirstCompileDone = true;
  });

  const rsbuildServer = await rsbuild.createDevServer();

  app.get('/', (req, res, next) => {
    if (!isFirstCompileDone) {
      return next();
    }

    serverRender(req, res, next)
  });

  app.use(rsbuildServer.middlewares);

  const httpServer = app.listen(rsbuildServer.port, async () => {
    await rsbuildServer.afterListen();
  });

  httpServer.on("upgrade", rsbuildServer.onHTTPUpgrade);

  return {
    close: async () => {
      await rsbuildServer.close();
      httpServer.close();
    },
  };
}

startDevServer();
