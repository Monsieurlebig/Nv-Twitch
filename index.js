const puppeteer = require('puppeteer');
const { Hono } = require('hono');
const { serve } = require('@hono/node-server');

const app = new Hono();

app.get('/', async (c) => {
  try {
    const url = c.req.query('url') || 'https://apify.com';

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: '/usr/bin/google-chrome-stable',
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); // Timeout de 60 secondes

    // Vérifier si le bouton "Commencer à regarder" est présent et cliquer dessus si nécessaire
    const button = await page.$('[data-a-target="content-classification-gate-overlay-start-watching-button"]');
    if (button) {
      console.log("Bouton trouvé, on clique dessus...");
      await button.click();
      await page.waitForTimeout(30000); // Petit délai pour que la vidéo charge
    } else {
      console.log("Pas de bouton, on continue...");
    }

    // Attendre que la vidéo soit présente dans la page
    await page.waitForFunction(() => document.querySelector('video')?.src, { timeout: 60000 });

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
      return c.json({ url: url, videoUrl: videoUrl });
    } else {
      console.warn(`No video URL found for ${url}`);
      return c.json({ url: url, videoUrl: null });
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
