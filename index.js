#!/usr/bin/env node
// test diff 
import { Command } from 'commander';
import Parser from 'rss-parser';
import pc from 'picocolors';
import prompts from 'prompts';
import open from 'open';
import * as cheerio from 'cheerio';
import { spawn } from 'child_process';
import fs from 'fs';

// Supported regions mapping for localization
const REGIONS = {
  us: { hl: 'en-US', gl: 'US', ceid: 'US:en', name: 'United States (English)' },
  uk: { hl: 'en-GB', gl: 'GB', ceid: 'GB:en', name: 'United Kingdom (English)' },
  in: { hl: 'en-IN', gl: 'IN', ceid: 'IN:en', name: 'India (English)' },
  ca: { hl: 'en-CA', gl: 'CA', ceid: 'CA:en', name: 'Canada (English)' },
  au: { hl: 'en-AU', gl: 'AU', ceid: 'AU:en', name: 'Australia (English)' },
  fr: { hl: 'fr', gl: 'FR', ceid: 'FR:fr', name: 'France (French)' },
  de: { hl: 'de', gl: 'DE', ceid: 'DE:de', name: 'Germany (German)' },
  jp: { hl: 'ja', gl: 'JP', ceid: 'JP:ja', name: 'Japan (Japanese)' },
  br: { hl: 'pt-419', gl: 'BR', ceid: 'BR:pt-419', name: 'Brazil (Portuguese)' }
};

// Predefined topic keys in Google News
const TOPICS = {
  world: 'WORLD',
  nation: 'NATION',
  business: 'BUSINESS',
  technology: 'TECHNOLOGY',
  entertainment: 'ENTERTAINMENT',
  sports: 'SPORTS',
  science: 'SCIENCE',
  health: 'HEALTH'
};

// Trusted sources list (case-insensitive)
const TRUSTED_SOURCES = new Set([
  'reuters',
  'ap',
  'associated press',
  'bloomberg',
  'bbc',
  'bbc news',
  'the new york times',
  'new york times',
  'the wall street journal',
  'wall street journal',
  'financial times',
  'the guardian',
  'axios',
  'npr',
  'cnbc',
  'the economist',
  'propublica',
  'deutsche welle',
  'dw',
  'le monde',
  'al jazeera'
]);

// Vocabulary for lightweight dependency-free sentiment analyzer
const POSITIVE_WORDS = new Set([
  'success', 'successful', 'successfully', 'win', 'won', 'winner', 'breakthrough', 'boost', 'improve', 'improved',
  'improving', 'improvement', 'gain', 'growth', 'grew', 'grow', 'recovery', 'recover', 'recovered', 'positive',
  'optimism', 'optimistic', 'advance', 'advanced', 'advancement', 'deal', 'agreement', 'agree', 'agreed',
  'celebrate', 'celebrating', 'celebration', 'alliance', 'innovation', 'innovative', 'pioneer', 'safe', 'safety',
  'peace', 'peaceful', 'progress', 'benefit', 'beneficial', 'strong', 'strengthen', 'strengthened'
]);

const NEGATIVE_WORDS = new Set([
  'crash', 'drop', 'dropped', 'dropping', 'fail', 'failed', 'failure', 'death', 'dead', 'die', 'dying',
  'kill', 'killed', 'killing', 'fire', 'war', 'battle', 'conflict', 'dispute', 'disputed', 'protest', 'protesting',
  'arrest', 'arrested', 'guilty', 'rape', 'crime', 'criminal', 'murder', 'murdered', 'slay', 'tragedy',
  'tragic', 'loss', 'lost', 'losing', 'decline', 'declining', 'declined', 'crisis', 'danger', 'dangerous',
  'threat', 'threaten', 'threatened', 'fear', 'scare', 'scared', 'worry', 'worried', 'concern', 'concerned'
]);

// Analyzes keyword-based sentiment of a summary
function analyzeSentiment(text) {
  if (!text) return { score: 0, label: '🟡 Neutral' };
  const cleanWords = text.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
    .split(/\s+/);
  
  let score = 0;
  cleanWords.forEach(w => {
    if (POSITIVE_WORDS.has(w)) score++;
    if (NEGATIVE_WORDS.has(w)) score--;
  });
  
  if (score > 1) return { score, label: '🟢 Positive' };
  if (score < -1) return { score, label: '🔴 Negative' };
  return { score, label: '🟡 Neutral' };
}

// Global process handle to allow stopping PowerShell TTS process
let ttsProcess = null;

// Speaks summary text aloud using native Windows PowerShell SAPI SpeechSynthesizer
function speakText(text) {
  stopSpeech(); // Ensure previous synthesis is killed
  
  const cleanText = text
    .replace(/"/g, '')
    .replace(/'/g, "''")
    .replace(/\n/g, ' ');
    
  const script = `Add-Type -AssemblyName System.Speech; $speak = New-Object System.Speech.Synthesis.SpeechSynthesizer; $speak.Speak('${cleanText}');`;
  
  // Spawn powershell with stdin Command mode
  ttsProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-']);
  
  // Write the script to powershell stdin
  ttsProcess.stdin.write(script);
  ttsProcess.stdin.end();
}

// Aborts the spawned text-to-speech child process
function stopSpeech() {
  if (ttsProcess) {
    try {
      ttsProcess.kill('SIGTERM');
    } catch (e) {
      // Ignored
    }
    ttsProcess = null;
  }
}

// Friendly relative time formatter
function getRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMins / 60);
  const diffDays = Math.round(diffHours / 24);

  if (isNaN(date.getTime())) return '';
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// Cleans up the article title by extracting the source if it is appended (e.g. "Headline - Source")
function parseArticle(item) {
  let title = item.title || '';
  let source = '';
  
  // Google News RSS titles usually end with " - Source Name"
  const sourceIndex = title.lastIndexOf(' - ');
  if (sourceIndex !== -1) {
    source = title.substring(sourceIndex + 3).trim();
    title = title.substring(0, sourceIndex).trim();
  }

  // Fallback check if parser found a source element
  if (!source && item.source) {
    source = typeof item.source === 'object' ? item.source._ : item.source;
  }

  return {
    title,
    source: source || 'Google News',
    link: item.link,
    pubDate: item.pubDate,
    relativeTime: getRelativeTime(item.pubDate)
  };
}

// Helper to decode HTML entities in data-p
function decodeHtmlEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"');
}

// Resolves a Google News RSS article URL to the original publisher URL
async function getArticleUrl(googleRssUrl) {
  const response = await fetch(googleRssUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch redirect page: HTTP ${response.status}`);
  }
  const html = await response.text();
  
  const match = html.match(/<c-wiz[^>]+data-p="([^"]+)"/);
  if (!match) {
    throw new Error('Could not find data-p attribute in HTML');
  }
  
  const rawData = decodeHtmlEntities(match[1]);
  const obj = JSON.parse(rawData.replace('%.@.', '["garturlreq",'));
  
  const payloadData = [...obj.slice(0, -6), ...obj.slice(-2)];
  const payload = new URLSearchParams();
  payload.append('f.req', JSON.stringify([[
    ['Fbv4je', JSON.stringify(payloadData), 'null', 'generic']
  ]]));
  
  const postResponse = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    body: payload.toString()
  });
  
  if (!postResponse.ok) {
    throw new Error(`Failed to resolve original URL: HTTP ${postResponse.status}`);
  }
  
  const responseText = await postResponse.text();
  const cleanJsonText = responseText.replace(")]}'\n", "");
  const resObj = JSON.parse(cleanJsonText);
  const arrayString = resObj[0][2];
  const articleUrl = JSON.parse(arrayString)[1];
  
  return articleUrl;
}

// Extracts clean article paragraphs from raw HTML using Cheerio
function extractTextFromHtml(html) {
  const $ = cheerio.load(html);
  
  // Clean elements that do not contain core article text
  $('script, style, head, nav, footer, header, aside, button, svg, iframe, form, noscript, dialog').remove();
  
  const paragraphs = [];
  $('p').each((_, el) => {
    const text = $(el).text()
      .replace(/\s+/g, ' ')
      .trim();
      
    // Filter out common cookie walls and share boilerplate
    if (text.length > 50 && 
        !text.includes('Copy link') && 
        !text.includes('Share page') &&
        !text.includes('About sharing') &&
        !text.includes('play video') &&
        !text.includes('Read more') &&
        !text.includes('Sign up for') &&
        !text.startsWith('Image source') &&
        !text.startsWith('Getty Images') &&
        !text.toLowerCase().includes('copyright')
    ) {
      paragraphs.push(text);
    }
  });
  
  return paragraphs;
}

// Splits paragraphs into sentences while protecting abbreviations
function splitIntoSentences(text) {
  const abbreviations = ['u.s.', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'inc.', 'corp.', 'co.', 'approx.', 'vs.', 'etc.'];
  let processed = text;
  
  abbreviations.forEach((abbr, idx) => {
    const regex = new RegExp(`\\b${abbr.replace('.', '\\.')}`, 'gi');
    processed = processed.replace(regex, `__ABBR_${idx}__`);
  });
  
  const sentences = processed.split(/(?<=[.!?])\s+/);
  
  return sentences.map(s => {
    let restored = s;
    abbreviations.forEach((abbr, idx) => {
      restored = restored.replace(new RegExp(`__ABBR_${idx}__`, 'g'), abbr.toUpperCase() === abbr ? abbr : abbr.charAt(0).toUpperCase() + abbr.slice(1));
    });
    return restored.trim();
  }).filter(s => s.length > 20);
}

// Custom list of common stop words
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their',
  'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and',
  'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between',
  'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off',
  'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any',
  'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'said', 'has', 'says', 'also', 'new', 'after',
  'first', 'two', 'last'
]);

// Generates an advanced frequency-based summary prioritizing numbers, statistics, proper nouns, and context
function generateSummary(paragraphs, sentenceCount = 7, title = '') {
  const allSentences = [];
  paragraphs.forEach(p => {
    const sents = splitIntoSentences(p);
    sents.forEach(s => {
      allSentences.push({
        text: s,
        index: allSentences.length
      });
    });
  });

  // Calculate strict sentence limit boundaries: [5, 10]
  const targetCount = Math.min(10, Math.max(5, sentenceCount));

  if (allSentences.length <= targetCount) {
    return allSentences.map(s => s.text).join('\n\n');
  }

  // Pre-parse title keywords for relevance matching
  const titleWords = new Set(
    title.toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  );

  // Calculate base word frequencies across the whole text
  const wordFreq = {};
  allSentences.forEach(s => {
    const words = s.text.toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
      .split(/\s+/);
    
    words.forEach(w => {
      if (w.length > 2 && !STOP_WORDS.has(w)) {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      }
    });
  });

  // Score sentences using combined metrics
  allSentences.forEach(s => {
    const text = s.text;
    const words = text.toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
      .split(/\s+/);
    
    // 1. Base TF frequency score
    let baseScore = 0;
    words.forEach(w => {
      if (wordFreq[w]) {
        baseScore += wordFreq[w];
      }
    });
    let score = words.length > 0 ? (baseScore / Math.sqrt(words.length)) : 0;

    // 2. Numbers & Statistics Boost
    // Matches numbers, percentages, currency, dates (e.g. 4.5%, $10 million, 2026)
    const statsRegex = /\b\d+(?:[\.,\-%/\\]\d*)*\b/g;
    const statsMatches = text.match(statsRegex);
    if (statsMatches) {
      score += statsMatches.length * 6; // High weight for metrics
    }
    
    const statsKeywords = /\b(percent|percentage|million|billion|trillion|percentile|statistics|data|average|median|revenue|earnings|quarter|fiscal|growth|inflation|rate|index|metrics)\b/gi;
    const keywordMatches = text.match(statsKeywords);
    if (keywordMatches) {
      score += keywordMatches.length * 3;
    }

    // 3. Proper Nouns / Placeholders Boost
    // Matches capitalized words that are not the first word of the sentence
    const properNounRegex = /\b[A-Z][a-z]+\b/g;
    const tailText = text.replace(/^\s*\b[A-Za-z]+\b/, ''); // strip the very first word
    const nounMatches = tailText.match(properNounRegex);
    if (nounMatches) {
      score += nounMatches.length * 2.5; // Weight proper noun placeholders
    }

    // 4. Title Context Relevance Boost
    let titleMatches = 0;
    words.forEach(w => {
      if (w.length > 3 && titleWords.has(w)) {
        titleMatches++;
      }
    });
    score += titleMatches * 2;

    // 5. Position-based Context Boost (favoring lead paragraphs)
    if (s.index === 0) score += 18;
    else if (s.index === 1) score += 12;
    else if (s.index === 2) score += 8;
    else if (s.index === 3) score += 4;

    s.score = score;
  });

  // Get top scored sentences
  const sorted = [...allSentences].sort((a, b) => b.score - a.score);
  const selected = sorted.slice(0, targetCount);

  // Restore chronological order of sentences for coherent reading
  selected.sort((a, b) => a.index - b.index);

  return selected.map(s => s.text).join('\n\n');
}

// Performs fetch with 5-second timeout using AbortController
async function fetchWithTimeout(url, options = {}) {
  const { timeout = 5000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function main() {
  const program = new Command();

  program
    .name('gnews')
    .description('CLI tool to get the latest news from Google News')
    .version('1.0.0')
    .option('-s, --search <query>', 'Search query for news')
    .option('-t, --topic <topic>', `News topic (${Object.keys(TOPICS).join(', ')})`)
    .option('-l, --limit <number>', 'Number of news articles to show', '7')
    .option('-r, --region <region>', `Country/language code (${Object.keys(REGIONS).join(', ')})`, 'us')
    .option('--trusted-only', 'Only display news from highly trusted international sources')
    .option('-p, --print', 'Print all article summaries straight to console non-interactively')
    .option('-o, --export <filename>', 'Export summaries report to a local Markdown file')
    .parse(process.argv);

  const options = program.opts();

  // Validate limit
  const limit = parseInt(options.limit, 10);
  if (isNaN(limit) || limit <= 0) {
    console.error(pc.red('❌ Error: Limit must be a positive integer.'));
    process.exit(1);
  }

  // Set initial query parameters
  let currentSearch = options.search;
  let currentTopic = options.topic;
  let currentRegionCode = options.region.toLowerCase();
  
  // In-Memory caches for resolved URLs and summaries
  const articleCache = new Map();

  // Ensure export file starts clean if specified
  if (options.export && !options.print) {
    try {
      fs.writeFileSync(options.export, `# Google News Live Digest\nGenerated on ${new Date().toLocaleString()}\n\n---\n\n`, 'utf8');
    } catch (e) {
      console.error(pc.red(`❌ Warning: Failed to initialize export file: ${e.message}`));
    }
  }

  // Outer loop to handle Refetching / Topic changing dynamically
  while (true) {
    // Validate region
    const region = REGIONS[currentRegionCode];
    if (!region) {
      console.error(pc.red(`❌ Error: Unsupported region "${currentRegionCode}".`));
      console.log(`Available regions: ${Object.keys(REGIONS).join(', ')}`);
      process.exit(1);
    }

    // Build RSS URL
    let rssUrl = 'https://news.google.com/rss';
    let contextLabel = 'Top Stories';

    if (currentSearch) {
      rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(currentSearch)}`;
      contextLabel = `Search: "${currentSearch}"`;
    } else if (currentTopic) {
      const topicKey = currentTopic.toLowerCase();
      const topicVal = TOPICS[topicKey];
      if (!topicVal) {
        console.error(pc.red(`❌ Error: Unsupported topic "${currentTopic}".`));
        console.log(`Available topics: ${Object.keys(TOPICS).join(', ')}`);
        process.exit(1);
      }
      rssUrl = `https://news.google.com/rss/headlines/section/topic/${topicVal}`;
      contextLabel = `Topic: ${topicKey.toUpperCase()}`;
    }

    // Append localization parameters
    rssUrl += `${rssUrl.includes('?') ? '&' : '?'}hl=${region.hl}&gl=${region.gl}&ceid=${region.ceid}`;

    console.log(pc.cyan(`\n📰 Fetching latest news from Google News...`));
    console.log(pc.dim(`📍 Region: ${region.name} | Category: ${contextLabel}\n`));

    const parser = new Parser();
    let feed;
    try {
      feed = await parser.parseURL(rssUrl);
    } catch (error) {
      console.error(pc.red(`❌ Failed to fetch news: ${error.message}`));
      
      if (options.print) {
        process.exit(1);
      }
      
      const retryAction = await prompts({
        type: 'confirm',
        name: 'retry',
        message: 'Would you like to try changing your search query or topic?',
        initial: true
      });
      
      if (retryAction.retry) {
        // Mock a query change flow
        const refetchQuery = await prompts({
          type: 'text',
          name: 'query',
          message: 'Enter new search query:'
        });
        if (refetchQuery.query) {
          currentSearch = refetchQuery.query;
          currentTopic = null;
          continue;
        }
      }
      process.exit(1);
    }

    if (!feed.items || feed.items.length === 0) {
      console.log(pc.yellow('⚠️ No news articles found.'));
      
      if (options.print) {
        process.exit(0);
      }
      
      const changeAction = await prompts({
        type: 'confirm',
        name: 'change',
        message: 'Search returned no results. Try another query?',
        initial: true
      });
      if (changeAction.change) {
        const refetchQuery = await prompts({
          type: 'text',
          name: 'query',
          message: 'Enter new search query:'
        });
        if (refetchQuery.query) {
          currentSearch = refetchQuery.query;
          currentTopic = null;
          continue;
        }
      }
      process.exit(0);
    }

    // Parse articles
    let articles = feed.items.map(parseArticle);

    // Filter if trusted-only is requested
    if (options.trustedOnly) {
      articles = articles.filter(a => TRUSTED_SOURCES.has(a.source.toLowerCase()));
      if (articles.length === 0) {
        console.log(pc.yellow('⚠️ No articles from trusted sources found.'));
        if (options.print) {
          process.exit(0);
        }
        
        const changeAction = await prompts({
          type: 'confirm',
          name: 'change',
          message: 'No trusted articles found. Try another query/topic?',
          initial: true
        });
        if (changeAction.change) {
          currentSearch = null;
          currentTopic = 'world'; // fallback default
          continue;
        }
        process.exit(0);
      }
    }

    // Apply sorting: bubble up trusted sources to the top, keeping original feed ordering otherwise
    articles.sort((a, b) => {
      const aTrusted = TRUSTED_SOURCES.has(a.source.toLowerCase());
      const bTrusted = TRUSTED_SOURCES.has(b.source.toLowerCase());
      if (aTrusted && !bTrusted) return -1;
      if (!aTrusted && bTrusted) return 1;
      return 0;
    });

    // NON-INTERACTIVE PRINT MODE
    if (options.print) {
      const printArticles = articles.slice(0, limit);
      console.log(pc.cyan(`📰 Printing summaries for ${printArticles.length} articles...\n`));
      
      let exportContent = `# Google News Digest\nGenerated on ${new Date().toLocaleString()}\nRegion: ${region.name}\nCategory: ${contextLabel}\n\n---\n\n`;

      for (let i = 0; i < printArticles.length; i++) {
        const article = printArticles[i];
        const isTrusted = TRUSTED_SOURCES.has(article.source.toLowerCase());
        console.log(pc.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        const badge = isTrusted ? pc.green('★ [Trusted Source] ') : '';
        console.log(pc.bold(pc.white(`${i + 1}. ${badge}${article.title}`)));
        console.log(pc.dim(`📢  Source: ${article.source} | 🕒 ${article.relativeTime || 'Recently'}`));
        console.log(pc.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        
        console.log(pc.dim(`⏳ Fetching and generating summary (5-10 sentences)...`));
        
        let resolvedUrl = article.link;
        let summaryText = '';
        let successfullySummarized = false;

        try {
          resolvedUrl = await getArticleUrl(article.link);
          const articleResponse = await fetchWithTimeout(resolvedUrl, {
            timeout: 5000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          
          if (!articleResponse.ok) {
            throw new Error(`HTTP ${articleResponse.status}`);
          }
          
          const html = await articleResponse.text();
          const paragraphs = extractTextFromHtml(html);
          
          if (paragraphs.length > 0) {
            summaryText = generateSummary(paragraphs, 7, article.title);
            successfullySummarized = true;
            console.log(pc.white(summaryText));
          } else {
            console.log(pc.yellow('⚠️  Could not extract enough text from the page to generate a summary.'));
            console.log(pc.dim(`🔗 URL: ${resolvedUrl}`));
          }
        } catch (err) {
          console.log(pc.yellow(`⚠️  Failed to fetch or summarize: ${err.name === 'AbortError' ? 'Request timed out (5s)' : err.message}`));
          console.log(pc.dim(`🔗 URL: ${resolvedUrl}`));
        }
        
        const sentiment = analyzeSentiment(summaryText || article.title);
        
        if (successfullySummarized) {
          exportContent += `## ${badge ? '★ ' : ''}${article.title}\n`;
          exportContent += `- **Source:** ${article.source}\n`;
          exportContent += `- **Published:** ${article.relativeTime || 'Recently'}\n`;
          exportContent += `- **Link:** ${resolvedUrl}\n`;
          exportContent += `- **Sentiment:** ${sentiment.label}\n\n`;
          exportContent += `${summaryText}\n\n`;
          exportContent += `---\n\n`;
        }
        
        console.log(pc.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
      }

      if (options.export) {
        try {
          fs.writeFileSync(options.export, exportContent, 'utf8');
          console.log(pc.green(`💾 Exported summaries report to ${options.export}\n`));
        } catch (e) {
          console.error(pc.red(`❌ Failed to write export file: ${e.message}`));
        }
      }
      process.exit(0);
    }

    // INTERACTIVE LIST SELECTION
    let currentLimit = limit;
    let initialIndex = 0;
    let shouldRefetch = false;

    while (true) {
      // Slice visible articles based on current pagination limit
      const visibleArticles = articles.slice(0, currentLimit);

      // Map visible articles to prompt choices
      const choices = visibleArticles.map((article, index) => {
        const isTrusted = TRUSTED_SOURCES.has(article.source.toLowerCase());
        const displayIndex = pc.dim(`${String(index + 1).padStart(2, ' ')}.`);
        const coloredTitle = pc.white(article.title);
        
        const badge = isTrusted ? pc.green('★ [Trusted] ') : '';
        const coloredSource = isTrusted 
          ? pc.green(`[${article.source}]`) 
          : pc.blue(`[${article.source}]`);
        const coloredTime = article.relativeTime ? pc.gray(`(${article.relativeTime})`) : '';

        return {
          title: `${displayIndex} ${badge}${coloredTitle} ${coloredSource} ${coloredTime}`,
          value: article.link
        };
      });

      // Append 'Change search query/topic' choice
      choices.push({
        title: pc.yellow('🔍 [Change Search Query/Topic...]'),
        value: 'change_query'
      });

      // Append 'Load More' choice if there are more articles left in the feed
      if (articles.length > currentLimit) {
        choices.push({
          title: pc.cyan('🔄 [Load More Articles...]'),
          value: 'load_more'
        });
      }

      // Append Exit choice
      choices.push({
        title: pc.red('🚪 [Exit]'),
        value: 'exit'
      });

      const response = await prompts({
        type: 'select',
        name: 'url',
        message: 'Use arrow keys to scroll, press Enter to view summary:',
        choices: choices,
        initial: initialIndex,
        hint: ' ' // Clear the default "Instructions" hint text for cleaner UI
      });

      if (!response.url || response.url === 'exit') {
        console.log(pc.yellow('\nGoodbye! 👋\n'));
        process.exit(0);
      }

      // CHANGE QUERY / TOPIC SUB-MENU
      if (response.url === 'change_query') {
        const changeAction = await prompts({
          type: 'select',
          name: 'type',
          message: 'Refetch Google News by modifying:',
          choices: [
            { title: '🔎 Run a new text search', value: 'search' },
            { title: '📁 Select a category topic', value: 'topic' },
            { title: '📍 Change region/language', value: 'region' },
            { title: '🔙 Back to current list', value: 'back' }
          ]
        });

        if (changeAction.type === 'search') {
          const queryResponse = await prompts({
            type: 'text',
            name: 'query',
            message: 'Enter search query:'
          });
          if (queryResponse.query) {
            currentSearch = queryResponse.query;
            currentTopic = null; // override topic
            shouldRefetch = true;
            break; // Break inner loop, trigger outer loop fetch
          }
        } else if (changeAction.type === 'topic') {
          const topicResponse = await prompts({
            type: 'select',
            name: 'topic',
            message: 'Select category:',
            choices: Object.keys(TOPICS).map(t => ({ title: t.toUpperCase(), value: t }))
          });
          if (topicResponse.topic) {
            currentTopic = topicResponse.topic;
            currentSearch = null; // override search
            shouldRefetch = true;
            break; // Break inner loop, trigger outer loop fetch
          }
        } else if (changeAction.type === 'region') {
          const regionResponse = await prompts({
            type: 'select',
            name: 'region',
            message: 'Select country/language region:',
            choices: Object.keys(REGIONS).map(r => ({ title: REGIONS[r].name, value: r }))
          });
          if (regionResponse.region) {
            currentRegionCode = regionResponse.region;
            shouldRefetch = true;
            break; // Break inner loop, trigger outer loop fetch
          }
        }
        continue;
      }

      // LOAD MORE PAGINATION
      if (response.url === 'load_more') {
        initialIndex = currentLimit; // focus cursor on the first newly added item
        currentLimit += limit;       // expand articles visible count
        console.log();
        continue;
      }

      // Keep track of active selection index so we return to it
      initialIndex = choices.findIndex(c => c.value === response.url);
      const selectedArticle = visibleArticles[initialIndex];

      // Check Cache first before fetching
      let cacheData = articleCache.get(response.url);
      let resolvedUrl = response.url;
      let summaryText = '';
      let successfullySummarized = false;

      if (cacheData) {
        console.log(pc.green(`\n⚡ Loaded instantly from cache!`));
        resolvedUrl = cacheData.resolvedUrl;
        summaryText = cacheData.summaryText;
        successfullySummarized = cacheData.successfullySummarized;
      } else {
        console.log(pc.cyan(`\n⏳ Fetching article and generating summary (5-10 sentences)...`));
        try {
          resolvedUrl = await getArticleUrl(response.url);
          
          const articleResponse = await fetchWithTimeout(resolvedUrl, {
            timeout: 5000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          
          if (!articleResponse.ok) {
            throw new Error(`Failed to fetch article body: HTTP ${articleResponse.status}`);
          }
          
          const html = await articleResponse.text();
          const paragraphs = extractTextFromHtml(html);
          
          if (paragraphs.length > 0) {
            summaryText = generateSummary(paragraphs, 7, selectedArticle.title);
            if (summaryText.trim().length > 0) {
              successfullySummarized = true;
            }
          }
        } catch (err) {
          if (err.name === 'AbortError') {
            summaryText = '⚠️  Request timed out. The original publisher website did not respond within 5 seconds.';
          } else {
            summaryText = `⚠️  Could not load article body: ${err.message}`;
          }
        }

        // Cache the result
        articleCache.set(response.url, {
          resolvedUrl,
          summaryText,
          successfullySummarized
        });
      }

      // Analyze summary sentiment
      const sentiment = analyzeSentiment(summaryText || selectedArticle.title);

      // Display Summary Container
      const isTrusted = TRUSTED_SOURCES.has(selectedArticle.source.toLowerCase());
      const badge = isTrusted ? pc.green('★ [Trusted Source] ') : '';
      console.log(pc.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(pc.bold(pc.white(`📰  ${badge}${selectedArticle.title}`)));
      console.log(pc.dim(`📢  Source: ${selectedArticle.source} | 🕒 ${selectedArticle.relativeTime || 'Recently'}`));
      console.log(pc.cyan(`📊  Sentiment: ${sentiment.label}`));
      console.log(pc.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

      if (successfullySummarized) {
        console.log(pc.white(summaryText));
      } else {
        console.log(pc.yellow(summaryText || '⚠️  Could not extract enough text from the page to generate a summary.'));
        console.log(pc.dim('The article may require JavaScript, be paywalled, or be behind a cookie consent wall.'));
        console.log(pc.dim(`🔗 URL: ${resolvedUrl}`));
      }
      console.log(pc.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

      // If exporting is enabled, append this read summary to file
      if (options.export && successfullySummarized) {
        try {
          const reportEntry = `## ${isTrusted ? '★ ' : ''}${selectedArticle.title}\n- **Source:** ${selectedArticle.source}\n- **Published:** ${selectedArticle.relativeTime || 'Recently'}\n- **Link:** ${resolvedUrl}\n- **Sentiment:** ${sentiment.label}\n- **Saved at:** ${new Date().toLocaleString()}\n\n${summaryText}\n\n---\n\n`;
          fs.appendFileSync(options.export, reportEntry, 'utf8');
          console.log(pc.green(`💾 Saved and appended summary to ${options.export}`));
        } catch (e) {
          console.error(pc.red(`❌ Warning: Failed to export summary to file: ${e.message}`));
        }
      }

      // Options sub-menu loop (so TTS can be run, then return to options menu)
      let articleMenuLoop = true;
      while (articleMenuLoop) {
        const action = await prompts({
          type: 'select',
          name: 'value',
          message: 'What would you like to do next?',
          choices: [
            { title: '🌐 Open full article in browser', value: 'open' },
            { title: '🔊 Listen to summary (Text-to-Speech)', value: 'speak' },
            { title: '🔙 Back to article list', value: 'back' },
            { title: '🚪 Exit', value: 'exit' }
          ]
        });

        if (action.value === 'open') {
          console.log(pc.green(`\n🔗 Opening article in your browser...`));
          console.log(pc.dim(resolvedUrl));
          try {
            await open(resolvedUrl);
          } catch (err) {
            console.error(pc.red(`❌ Failed to open link: ${err.message}`));
          }
          await prompts({
            type: 'text',
            name: 'confirm',
            message: 'Press Enter to return...'
          });
        } else if (action.value === 'speak') {
          console.log(pc.green(`\n🔊 Speaking summary aloud...`));
          speakText(`${selectedArticle.title}. Summary: ${summaryText || 'No summary text available.'}`);
          
          await prompts({
            type: 'text',
            name: 'confirm',
            message: 'Press Enter to stop reading and return to menu...'
          });
          stopSpeech();
          console.log(pc.dim('🔊 Speech stopped.'));
        } else if (action.value === 'back') {
          articleMenuLoop = false;
        } else if (action.value === 'exit' || !action.value) {
          console.log(pc.yellow('\nGoodbye! 👋\n'));
          process.exit(0);
        }
      }
      console.log();
    }

    // If change query/topic breaks inner loop, we restart outer loop
    if (!shouldRefetch) {
      break;
    }
  }
}

main();
