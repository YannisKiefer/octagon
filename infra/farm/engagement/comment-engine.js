#!/usr/bin/env node
/**
 * 🧠 OCTAGON — LLM-Powered Human Comment Engine
 *
 * Generates contextually aware comments that match the platform,
 * niche, and content being viewed. Uses Gemini API for generation
 * with fallback to template-based comments.
 *
 * Features:
 *   - Platform-specific comment styles (TikTok slang vs IG polish vs YT depth)
 *   - Niche-aware vocabulary (ecom, AI/tech, business, lifestyle)
 *   - Length variation (single word → full sentences)
 *   - Emoji usage calibrated per platform
 *   - Typo injection for realism
 *   - Rate limiting (avoids comment flooding)
 *
 * Usage:
 *   node farm/engagement/comment-engine.js --platform=tiktok --niche=ecom
 *   node farm/engagement/comment-engine.js --platform=instagram --niche=ai_tech --count=5
 */

'use strict';

const { execSync } = require('child_process');

// ─── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : def;
};

const platform = getArg('platform', 'tiktok');
const niche = getArg('niche', 'ecom');
const count = parseInt(getArg('count', '1'));
const useApi = getArg('api', 'true') === 'true';

// ─── Platform-Specific Comment Style Guides ────────────────────────────────────

const STYLE_GUIDES = {
  tiktok: {
    maxLength: 80,
    emojiDensity: 'high',     // 1-3 emojis per comment
    style: 'casual, gen-z slang, abbreviations, lowercase, sometimes all caps for emphasis',
    examplePatterns: [
      'no wayy 😭', 'this is actually insane', 'need this asap', 'bro what 💀',
      'ok but this actually works??', 'literally same', 'W content fr',
      'commenting for the algo 📈', 'pov: you found the best content on tiktok',
      'why is no one talking about this', 'game changer fr fr',
    ],
    typoRate: 0.08,
  },
  instagram: {
    maxLength: 120,
    emojiDensity: 'medium',   // 1-2 emojis per comment
    style: 'polished but still casual, supportive, uses emojis tastefully, complete sentences',
    examplePatterns: [
      'Obsessed with this 🔥', 'This is so underrated', 'Saving this for later!',
      'The quality is insane 👏', 'You always deliver', 'The aesthetic here is everything ✨',
      'How do you do this consistently??', 'Needed to see this today',
    ],
    typoRate: 0.03,
  },
  youtube: {
    maxLength: 200,
    emojiDensity: 'low',      // 0-1 emojis
    style: 'thoughtful, adds value, references specific parts, asks follow-up questions, longer form',
    examplePatterns: [
      'This is genuinely useful, been looking for something like this for weeks',
      'The part about X really opened my eyes, would love to see a deeper dive',
      'Subscribed. The production quality here is top tier.',
      'I tried this and it actually worked, thanks for sharing',
      'Would love to see a follow up on this topic',
    ],
    typoRate: 0.02,
  },
};

// ─── Niche Vocabularies ────────────────────────────────────────────────────────

const NICHE_VOCAB = {
  ecom: {
    keywords: ['revenue', 'store', 'conversion', 'product', 'shipping', 'brand', 'sales', 'shopify', 'dropship', 'margin'],
    reactions: ['this is printing money', 'how have I not been doing this', 'my store needs this', 'the roi on this must be insane'],
    topics: ['e-commerce strategy', 'product sourcing', 'online store growth', 'conversion optimization'],
  },
  ai_tech: {
    keywords: ['AI', 'model', 'automation', 'tech', 'API', 'startup', 'prompt', 'GPT', 'agent', 'workflow'],
    reactions: ['the future is now', 'this changes everything', 'been building something similar', 'the automation possibilities here'],
    topics: ['AI tools', 'tech automation', 'startup building', 'software development'],
  },
  business: {
    keywords: ['growth', 'scale', 'revenue', 'strategy', 'founder', 'B2B', 'SaaS', 'client', 'pipeline', 'ROI'],
    reactions: ['solid strategy', 'implementing this tomorrow', 'underrated advice', 'this is what they dont teach in business school'],
    topics: ['business growth', 'entrepreneurship', 'sales strategy', 'company scaling'],
  },
  lifestyle: {
    keywords: ['daily', 'routine', 'vibe', 'aesthetic', 'self-care', 'morning', 'fitness', 'travel', 'food', 'style'],
    reactions: ['living the dream', 'manifesting this energy', 'this aesthetic tho', 'adding to my vision board'],
    topics: ['daily routines', 'lifestyle design', 'personal wellness', 'travel adventures'],
  },
};

// ─── Typo Injection ────────────────────────────────────────────────────────────

function injectTypos(text, rate = 0.05) {
  if (Math.random() > rate) return text; // Most comments stay clean

  const words = text.split(' ');
  const targetIdx = Math.floor(Math.random() * words.length);
  const word = words[targetIdx];
  
  if (word.length < 3) return text;

  const typoTypes = [
    // Swap adjacent letters
    () => {
      const i = Math.floor(Math.random() * (word.length - 1));
      return word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
    },
    // Double a letter
    () => {
      const i = Math.floor(Math.random() * word.length);
      return word.slice(0, i) + word[i] + word.slice(i);
    },
    // Drop a letter (not first/last)
    () => {
      if (word.length < 4) return word;
      const i = 1 + Math.floor(Math.random() * (word.length - 2));
      return word.slice(0, i) + word.slice(i + 1);
    },
  ];

  words[targetIdx] = typoTypes[Math.floor(Math.random() * typoTypes.length)]();
  return words.join(' ');
}

// ─── Template-Based Fallback Generator ─────────────────────────────────────────

function generateTemplateComment(platform, niche) {
  const style = STYLE_GUIDES[platform] || STYLE_GUIDES.tiktok;
  const vocab = NICHE_VOCAB[niche] || NICHE_VOCAB.ecom;

  // Pick a base pattern
  const patterns = [
    ...style.examplePatterns,
    ...vocab.reactions,
  ];
  
  let comment = patterns[Math.floor(Math.random() * patterns.length)];

  // Sometimes add a niche keyword reference
  if (Math.random() < 0.3) {
    const keyword = vocab.keywords[Math.floor(Math.random() * vocab.keywords.length)];
    const prefixes = ['the', 'this', 'your'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    comment += ` ${prefix} ${keyword} part 👌`;
  }

  // Platform-specific emoji injection
  const emojis = ['🔥', '💯', '✨', '👏', '📈', '🙌', '😭', '💀', '🤯', '⚡', '🚀'];
  if (style.emojiDensity === 'high' && Math.random() < 0.6) {
    comment += ' ' + emojis[Math.floor(Math.random() * emojis.length)];
  } else if (style.emojiDensity === 'medium' && Math.random() < 0.3) {
    comment += ' ' + emojis[Math.floor(Math.random() * emojis.length)];
  }

  // Inject typos for realism
  comment = injectTypos(comment, style.typoRate);

  // Case variation
  if (platform === 'tiktok' && Math.random() < 0.3) {
    comment = comment.toLowerCase();
  }

  return comment.substring(0, style.maxLength);
}

// ─── Gemini API Generator ──────────────────────────────────────────────────────

async function generateGeminiComment(platform, niche, contentContext = '') {
  const style = STYLE_GUIDES[platform] || STYLE_GUIDES.tiktok;
  const vocab = NICHE_VOCAB[niche] || NICHE_VOCAB.ecom;

  // Try to read API key from env
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return generateTemplateComment(platform, niche);
  }

  const prompt = `You are a real human ${niche.replace('_', '/')} enthusiast commenting on ${platform}. 

Write ONE short comment (max ${style.maxLength} chars) that:
- Uses ${style.style}
- References ${niche.replace('_', '/')} topics naturally
- Sounds authentic (not generic, not corporate)
- ${contentContext ? `Relates to this content: "${contentContext}"` : `Is a general engagement comment about ${vocab.topics[Math.floor(Math.random() * vocab.topics.length)]}`}

Return ONLY the comment text, nothing else. No quotes.`;

  try {
    const response = execSync(`curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}" -H "Content-Type: application/json" -d '${JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 100 },
    }).replace(/'/g, "'\\''")}'`, { encoding: 'utf8', timeout: 10000 });

    const data = JSON.parse(response);
    let comment = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (comment) {
      // Remove quotes if wrapped
      comment = comment.replace(/^["']|["']$/g, '');
      comment = injectTypos(comment, style.typoRate);
      return comment.substring(0, style.maxLength);
    }
  } catch (e) {
    // Fallback to template
  }

  return generateTemplateComment(platform, niche);
}

// ─── Batch Generation ──────────────────────────────────────────────────────────

async function generateComments(platform, niche, count = 1, contentContext = '') {
  const comments = [];
  for (let i = 0; i < count; i++) {
    const comment = useApi
      ? await generateGeminiComment(platform, niche, contentContext)
      : generateTemplateComment(platform, niche);
    comments.push(comment);
    // Small delay between API calls
    if (useApi && i < count - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return comments;
}

// ─── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  const chalk = require('chalk');
  const contentContext = getArg('context', '');

  console.log(chalk.magenta.bold('\n🧠 OCTAGON COMMENT ENGINE'));
  console.log(chalk.gray(`Platform: ${platform} | Niche: ${niche} | Count: ${count} | API: ${useApi}`));
  console.log();

  const comments = await generateComments(platform, niche, count, contentContext);

  for (const [i, comment] of comments.entries()) {
    console.log(`  ${chalk.cyan(`[${i + 1}]`)} ${comment}`);
  }
  console.log();
}

// Export for farm-brain integration
module.exports = { generateComments, generateTemplateComment, STYLE_GUIDES, NICHE_VOCAB };

if (require.main === module) {
  main().catch(console.error);
}
