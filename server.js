import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' })); // Limit payload size

// Rate limiting: 10 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/paraphrase', limiter);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Gemini AI
let genAI, model;
try {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
} catch (error) {
  console.error('Error initializing Gemini AI:', error);
  process.exit(1);
}

// Validation function
function validateInput(text) {
  if (!text || typeof text !== 'string') {
    return 'Text must be a non-empty string.';
  }
  if (text.trim().length < 10) {
    return 'Text must be at least 10 characters long.';
  }
  return null;
}

// Paraphrase endpoint
app.post('/paraphrase', async (req, res) => {
  try {
    const { text } = req.body;
    const validationError = validateInput(text);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // Sanitize input: basic trimming
    const sanitizedText = text.trim();

    // Prompt for Gemini
    const prompt = `Rewrite the following text as if written by a university student explaining their own work. Keep the original meaning fully intact. Use natural sentence length variation. Maintain an academic but human tone. Avoid robotic or overly polished language. Do not add new facts. Do not shorten aggressively. Do not mention AI or rewriting in the output.

Original text: ${sanitizedText}`;

    // Generate response
    const result = await model.generateContent(prompt);
    const paraphrased = result.response.text().trim();

    res.json({ paraphrased });
  } catch (error) {
    console.error('Error in paraphrasing:', error);
    res.status(500).json({ error: 'An error occurred while paraphrasing the text.' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});