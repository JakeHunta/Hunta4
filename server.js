import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// API Keys
const SCRAPINGBEE_API_KEY = '025JQYMCQTSJI0AUPJ0SWCCR8BYQVM9BK91I355CKJWN4ULRDN5F7KA5U07I00TS9AQDFGBL6DKVEEVF';
const OPENAI_API_KEY = process.env.VITE_OPENAI_API_KEY || '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';

// OpenAI system prompt for extracting listings
const OPENAI_SYSTEM_PROMPT = `You are Hunta, an AI assistant. From this raw HTML page, extract listings with: title, image URL (if available), price, link, source (Gumtree). Output as an array of JSON objects.

Rules:
1. Only extract actual product listings, not ads or navigation elements
2. Clean up titles to remove extra whitespace and HTML entities
3. Ensure image URLs are complete and valid
4. Convert relative URLs to absolute URLs for Gumtree
5. Extract price as a string with currency symbol
6. Set source as "Gumtree" for all listings
7. Limit to maximum 10 listings
8. Skip listings with missing essential data (title, price, or link)

Return ONLY a valid JSON array, no additional text or explanation.`;

// Function to scrape Gumtree using ScrapingBee
async function scrapeGumtree(searchTerm) {
  try {
    const gumtreeUrl = `https://www.gumtree.com/search?search_category=all&q=${encodeURIComponent(searchTerm)}`;
    
    const response = await axios.get('https://app.scrapingbee.com/api/v1/', {
      params: {
        api_key: SCRAPINGBEE_API_KEY,
        url: gumtreeUrl,
        render_js: 'true',
        premium_proxy: 'true',
        country_code: 'gb'
      },
      timeout: 30000
    });

    return response.data;
  } catch (error) {
    console.error('ScrapingBee error:', error.message);
    throw new Error(`Failed to scrape Gumtree: ${error.message}`);
  }
}

// Function to extract listings using OpenAI
async function extractListingsWithOpenAI(htmlContent) {
  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: OPENAI_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: `Extract product listings from this HTML content:\n\n${htmlContent.substring(0, 15000)}` // Limit content to avoid token limits
        }
      ],
      temperature: 0.1,
      max_tokens: 2000
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const content = response.data.choices[0].message.content;
    
    // Clean and parse the JSON response
    let listings;
    try {
      // Remove markdown code block markers if present
      let cleanContent = content.trim();
      
      // Check if content is wrapped in markdown JSON code block
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      // Remove any leading/trailing whitespace
      cleanContent = cleanContent.trim();
      
      listings = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response as JSON:', content);
      throw new Error('Invalid JSON response from OpenAI');
    }

    // Validate and clean the listings
    const validListings = listings
      .filter(listing => 
        listing.title && 
        listing.price && 
        listing.link &&
        typeof listing.title === 'string' &&
        typeof listing.price === 'string' &&
        typeof listing.link === 'string'
      )
      .map(listing => ({
        title: listing.title.trim(),
        image: listing.image || null,
        price: listing.price.trim(),
        link: listing.link.startsWith('http') ? listing.link : `https://www.gumtree.com${listing.link}`,
        source: 'Gumtree'
      }))
      .slice(0, 10); // Limit to 10 results

    return validListings;
  } catch (error) {
    console.error('OpenAI error:', error.message);
    throw new Error(`Failed to extract listings: ${error.message}`);
  }
}

// Search endpoint
app.post('/search', async (req, res) => {
  try {
    const { search_term } = req.body;

    if (!search_term || typeof search_term !== 'string' || search_term.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid search term. Please provide a non-empty string.'
      });
    }

    console.log(`Starting search for: "${search_term}"`);

    // Step 1: Scrape Gumtree
    console.log('Scraping Gumtree...');
    const htmlContent = await scrapeGumtree(search_term.trim());

    if (!htmlContent || htmlContent.length < 100) {
      throw new Error('Received empty or invalid HTML content from Gumtree');
    }

    // Step 2: Extract listings using OpenAI
    console.log('Extracting listings with OpenAI...');
    const listings = await extractListingsWithOpenAI(htmlContent);

    console.log(`Successfully extracted ${listings.length} listings`);

    // Return the structured listings
    res.json(listings);

  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({
      error: 'Search failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      scrapingbee: SCRAPINGBEE_API_KEY ? 'configured' : 'missing',
      openai: OPENAI_API_KEY ? 'configured' : 'missing'
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Hunta Backend API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      'POST /search': 'Search for second-hand items',
      'GET /health': 'Health check',
      'GET /': 'API information'
    },
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `${req.method} ${req.path} is not a valid endpoint`,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🎯 Hunta Backend API running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🔍 Search endpoint: POST http://localhost:${PORT}/search`);
  console.log(`🔑 ScrapingBee API: ${SCRAPINGBEE_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`🤖 OpenAI API: ${OPENAI_API_KEY ? '✅ Configured' : '❌ Missing'}`);
});

export default app;