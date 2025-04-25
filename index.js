const puppeteer = require('puppeteer-core');
const { Hono } = require('hono');
const { serve } = require('@hono/node-server');
const PCR = require("puppeteer-chromium-resolver");

const app = new Hono();

app.get('/', async (c) => {
  try {
    const urlToPrint = c.req.query('url') || 'https://apify.com';

    const stats = await PCR();
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
      executablePath: stats.executablePath,
      defaultViewport: { width: 1920, height: 945, deviceScaleFactor: 4 },
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000); // Set timeout to 60 seconds

    await page.goto(urlToPrint, {
      waitUntil: 'networkidle0',
    });

    // Wait for 5 seconds to ensure all content is loaded
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Clique sur le bouton si besoin
    const button = await page.$('[data-a-target="content-classification-gate-overlay-start-watching-button"]');
    if (button) {
      console.log("Bouton trouvé, on clique dessus...");
      await button.click();
      await page.waitForTimeout(1000); // Petit délai pour que la vidéo charge
    } else {
      console.log("Pas de bouton, on continue...");
    }

    // Attendre que la vidéo soit présente dans la page
    await page.waitForFunction(() => document.querySelector('video')?.src, { timeout: 15000 });

    // Essayer d'extraire l'URL de la vidéo
    let videoUrl = await page.$eval('video', video => video.src).catch(() => null);

    // Vérifier si la vidéo est dans un iframe
    if (!videoUrl) {
      console.log('No video found in main page, checking iframes...');
      for (const frame of page.frames()) {
        try {
          videoUrl = await frame.$eval('video', video => video.src);
          if (videoUrl) {
            console.log(`Video found in iframe: ${videoUrl}`);
            break;
          }
        } catch (error) {
          continue;
        }
      }
    }

    // Si aucune vidéo trouvée, tenter d’intercepter les requêtes médias
    if (!videoUrl) {
      console.log('No video found in DOM, intercepting network requests...');
      page.on('response', async response => {
        if (response.request().resourceType() === 'media') {
          const url = response.url();
          console.log(`Detected media URL: ${url}`);
          videoUrl = url;
        }
      });

      // Attendre quelques secondes pour intercepter les requêtes
      await page.waitForTimeout(5000);
    }

    if (videoUrl) {
      console.log(`Clip URL: ${videoUrl}`);
      // Sauvegarde dans Apify Dataset
      return c.json({ url: urlToPrint, videoUrl: videoUrl });
    } else {
      console.warn(`No video URL found for ${urlToPrint}`);
      return c.json({ url: urlToPrint, videoUrl: null });
    }

    await browser.close();
  } catch (error) {
    console.error(error);
    return c.text(`Error: ${error.message}`);
  }
});

const port = 8080;
serve({ fetch: app.fetch, port }).on('listening', () => {
  console.log(`Server is running on port ${port}`);
});
