import { pipeline } from '@xenova/transformers';

// Multiple model instances for parallel processing
let classifiers = [];
const NUM_MODEL_INSTANCES = 2; // Run 2 models simultaneously
let classificationQueue = [];
let activeProcessing = 0; // Track how many are currently processing
const MAX_CONCURRENT = 5; // Process up to 5 messages at once
const processingMessages = new Map(); // Track messages being processed

// Stats tracking
let stats = {
  totalClassified: 0,
  cacheHits: 0,
  concurrentBatches: 0,
  queuedMessages: 0,
  averageBatchSize: 0
};

/**
 * Initialize multiple instances of the classification model for parallel processing
 * Uses BART-large for better accuracy (larger but more accurate than distilbert)
 */
async function initClassifier() {
  if (classifiers.length === 0) {
    console.log(`🤖 Loading ${NUM_MODEL_INSTANCES} classification model instances (BART-large)...`);
    
    // Load multiple model instances in parallel
    const loadPromises = [];
    for (let i = 0; i < NUM_MODEL_INSTANCES; i++) {
      loadPromises.push(
        pipeline('zero-shot-classification', 'Xenova/bart-large-mnli').then(model => {
          console.log(`  ✅ Model instance ${i + 1}/${NUM_MODEL_INSTANCES} loaded`);
          return model;
        })
      );
    }
    
    classifiers = await Promise.all(loadPromises);
    console.log(`✅ All ${NUM_MODEL_INSTANCES} classification models loaded and ready`);
    console.log(`⚡ Concurrent processing: ${MAX_CONCURRENT} messages at once across ${NUM_MODEL_INSTANCES} models`);
  }
  
  // Round-robin model selection based on active processing count
  return classifiers[activeProcessing % classifiers.length];
}

/**
 * Process the classification queue when concurrent limit is reached
 */
async function processQueue() {
  while (classificationQueue.length > 0 && activeProcessing < MAX_CONCURRENT) {
    const item = classificationQueue.shift();
    if (item) {
      stats.queuedMessages++;
      console.log(`📥 Processing queued message (${classificationQueue.length} remaining in queue)`);
      processMessageImmediate(item);
    }
  }
}

/**
 * Process a single message immediately
 */
async function processMessageImmediate({ message, resolve, reject, messageId, confidenceBoost }) {
  activeProcessing++;
  
  try {
    const result = await classifyInternal(message, messageId, confidenceBoost);
    resolve(result);
  } catch (error) {
    reject(error);
  } finally {
    activeProcessing--;
    // Check if there are queued messages waiting
    if (classificationQueue.length > 0) {
      processQueue();
    }
  }
}

/**
 * Internal classification function
 */
async function classifyInternal(message, messageId, confidenceBoost = 0) {
  try {
    const model = await initClassifier();
    
    // Clean the message
    const text = message.trim().toLowerCase();
    
    // Quick filters for obvious cases
    if (text.length < 3) return 'ignore';
    if (text.match(/^(lol|lmao|bruh|fr|nah|yea|yeah|yep|ok|okay|haha|hehe|xd|💀|😂)$/i)) return 'ignore';
    
    // Filter out casual invitations/statements directed at other users
    if (text.match(/^(anyone wanna|who wants to|does anyone|anybody wanna|someone wanna|y'all wanna)/i)) return 'ignore';
    if (text.match(/^(umm|ummm|uhh|uhhh|hmm|hmmm)/i)) return 'ignore';
    if (text.match(/(that's|thats|that is).*(not supposed to|shouldn't|shouldnt)/i)) return 'ignore';
    if (text.match(/^(omg|wtf|wth|bruh|damn|dang|wow)/i)) return 'ignore';
    
    // Filter out sarcastic/dismissive responses
    if (text.match(/^(no shit|yea i know|yeah i know|i know|duh|obviously)/i)) return 'ignore';
    if (text.match(/(sherlock|fucker|dumbass|idiot|moron|stupid)/i)) return 'ignore';
    
    // STRONG server keyword detection - bypass AI if clearly about server
    const strongServerKeywords = /\b(rdm|vdm|frp|nlr|fear rp|failrp|fail rp|metagaming|powergaming|combat log|combat logging|new life rule|random death match|vehicle death match|lacomm|lacrp|whitelist|whitelisted|staff application|moderator|moderators|admin|admins|mod|mods|hr|shr|ia|melonly|ms|faction|department|sts|ssu|ssd|pd check|dc check|shift log|phase|training|promotion|demotion|infraction|punishment|punishments|mod call|modcall|safe zone|safezone|booster|exotic|electric car|roblox group|erlc|prc|server code|join code|mrpxl|mrpxlarized)\b/i;
    
    if (strongServerKeywords.test(text)) {
      console.log(`🎮 [${messageId}] Strong server keyword detected, classifying as server-question`);
      return 'server-question';
    }
    
    // Real-world questions that are NOT about the server
    const realWorldIndicators = /(capital|mayor|president|election|elected|country|city|state|world|universe|planet|history|science|math|physics|geography|france|paris|london|america|europe|asia)/i;
    const serverIndicators = /(server|rules|ban|kick|roleplay)/i;
    
    // If has real-world indicators but no server indicators, likely general question
    if (realWorldIndicators.test(text) && !serverIndicators.test(text)) {
      console.log(`🌍 [${messageId}] Real-world question detected, classifying as general-question`);
      return 'general-question';
    }
    
    stats.totalClassified++;
    
    // Define candidate labels with better distinction
    const labels = [
      'question about LACRP roleplay server rules, staff, or game mechanics',
      'question about real-world events, history, science, or general knowledge',
      'casual conversation not needing assistance'
    ];
    
    // Classify the message
    const result = await model(text, labels, { multi_label: false });
    
    // Get the top prediction
    const topLabel = result.labels[0];
    let topScore = result.scores[0];
    
    // Apply confidence boost if provided (e.g., when bot is mentioned)
    if (confidenceBoost > 0) {
      const originalScore = topScore;
      topScore = Math.min(1.0, topScore + confidenceBoost);
      console.log(`⚡ [${messageId}] Confidence boost applied: ${(originalScore * 100).toFixed(1)}% → ${(topScore * 100).toFixed(1)}%`);
    }
    
    // Log classification for debugging
    console.log(`🔍 [${messageId}] "${text.substring(0, 40)}..." → ${topLabel.substring(0, 30)} (${(topScore * 100).toFixed(1)}%)`);
    
    // Map labels to response types
    // Threshold set to 0.71 with BART-large-mnli model
    // Requires 71% confidence to respond
    if (topScore < 0.71) {
      return 'ignore'; // Low confidence, don't respond
    }
    
    // Extra check: if it's classified as conversation, require higher confidence
    if (topLabel.includes('casual conversation')) {
      return 'ignore'; // Always ignore casual conversation
    }
    
    if (topLabel.includes('LACRP server')) {
      return 'server-question';
    } else if (topLabel.includes('general knowledge')) {
      return 'general-question';
    } else {
      return 'ignore';
    }
    
  } catch (error) {
    console.error(`Error classifying message ${messageId}:`, error);
    return 'ignore';
  }
}

/**
 * Classify a message to determine if the bot should respond
 * Returns: 'server-question' | 'general-question' | 'ignore'
 * 
 * @param {string} message - The message to classify
 * @param {string} messageId - ID for logging
 * @param {number} confidenceBoost - Optional boost to add to confidence (0.0-1.0)
 * 
 * Process immediately if under 5 concurrent, queue if over
 */
export async function classifyMessage(message, messageId = 'unknown', confidenceBoost = 0) {
  // Deduplication: Check if already processing this exact message
  const messageHash = `${message.trim().toLowerCase()}_${Date.now()}`;
  
  if (processingMessages.has(message.trim().toLowerCase())) {
    stats.cacheHits++;
    console.log(`⚡ [${messageId}] Duplicate detected (cache hit #${stats.cacheHits})`);
    return processingMessages.get(message.trim().toLowerCase());
  }
  
  // Create a promise for this classification
  const promise = new Promise((resolve, reject) => {
    const item = { message, resolve, reject, messageId, confidenceBoost };
    
    // If under concurrent limit, process immediately
    if (activeProcessing < MAX_CONCURRENT) {
      console.log(`⚡ [${messageId}] Processing immediately (${activeProcessing}/${MAX_CONCURRENT} active)`);
      processMessageImmediate(item);
    } else {
      // Otherwise add to queue
      console.log(`⏳ [${messageId}] Queuing (${activeProcessing}/${MAX_CONCURRENT} active, ${classificationQueue.length} in queue)`);
      classificationQueue.push(item);
    }
  });
  
  // Mark as processing
  processingMessages.set(message.trim().toLowerCase(), promise);
  
  // Wait for result
  const result = await promise;
  
  // Clean up after 5 seconds to allow for near-duplicate detection
  setTimeout(() => {
    processingMessages.delete(message.trim().toLowerCase());
  }, 5000);
  
  return result;
}

/**
 * Simple heuristic check if message looks like a question
 */
export function looksLikeQuestion(message) {
  const text = message.trim().toLowerCase();
  
  // Must be at least 5 characters
  if (text.length < 5) return false;
  
  // Filter out pure gibberish or very short messages
  if (text.match(/^[^\w\s?]+$/)) return false; // Only symbols/emojis
  if (text.match(/^(lol|lmao|bruh|fr|nah|yea|yeah|yep|ok|okay|haha|hehe|xd)$/i)) return false;
  
  // Filter out casual statements first
  if (text.match(/^(anyone wanna|who wants to|does anyone|anybody wanna|someone wanna)/i)) return false;
  if (text.match(/^(omg|wtf|wth|bruh|damn|umm|uhh|hmm)/i)) return false;
  
  // Filter out sarcastic/dismissive responses
  if (text.match(/^(no shit|yea i know|yeah i know|i know|duh|obviously)/i)) return false;
  if (text.match(/(sherlock|fucker|dumbass|idiot)/i)) return false;
  
  // Filter out meta-statements about Garmin itself (only statements, not questions TO garmin)
  // This catches "garmin has no chill" but NOT "garmin what is rdm"
  if (text.match(/\bgarmin (has|is|does|doesn't|isn't|didnt|didn't|won't|wont|cant|can't|will|should)\b/i)) return false;
  if (text.match(/\b(why|how come|wtf|wth).*(garmin|it|the bot).*(ignor|respond|answer|reply)/i)) return false;
  
  // Check for question mark BEFORE filtering bot commands
  // This ensures "what is rdm?" is treated as a question, not a command
  const hasQuestionMark = text.includes('?') && !text.match(/^(yea|yeah|really|seriously|right)\?/i);
  
  // Filter out commands for other bots
  // Commands like !ban, /help, ?purge should be ignored
  if (text.match(/^[!\/\?]\w+\s*\d*$/)) return false; // ?purge 50, !ban, /help
  if (text.match(/^[!\/]\w+/) && !text.match(/\b(what|who|when|where|why|how)\b/i)) return false;
  
  // Filter out role pings and Discord mentions alone
  if (text.match(/^<@[&!]?\d+>\s*[\^~\-]*$/)) return false;
  
  // Filter out gibberish (random letters with no vowels pattern)
  const words = text.replace(/[^\w\s]/g, '').split(/\s+/);
  const hasRealWords = words.some(word => {
    if (word.length < 3) return false;
    // Check if word has vowels (real words usually do)
    return /[aeiou]/i.test(word);
  });
  if (!hasRealWords) return false;
  
  // Has question mark (already computed above)
  if (hasQuestionMark) return true;
  
  // Starts with common question words (but not casual invitations)
  const questionStarters = /^(what|who|when|where|why|how|can i|could i|would you|should i|is there|are there|do you|does it)/i;
  if (questionStarters.test(text)) return true;
  
  return false;
}

/**
 * Get classifier performance statistics
 */
export function getClassifierStats() {
  return {
    ...stats,
    queueSize: classificationQueue.length,
    cacheSize: processingMessages.size,
    activeProcessing,
    modelInstances: classifiers.length,
    averageBatchSize: stats.averageBatchSize.toFixed(2)
  };
}

/**
 * Change the number of model instances (requires Manage Server permission)
 */
export async function setModelInstances(numInstances) {
  console.log(`🔄 Changing from ${classifiers.length} to ${numInstances} model instances...`);
  
  // Clear existing models
  classifiers = [];
  
  // Load new instances
  console.log(`🤖 Loading ${numInstances} classification model instances (BART-large)...`);
  
  const loadPromises = [];
  for (let i = 0; i < numInstances; i++) {
    loadPromises.push(
      pipeline('zero-shot-classification', 'Xenova/bart-large-mnli').then(model => {
        console.log(`  ✅ Model instance ${i + 1}/${numInstances} loaded`);
        return model;
      })
    );
  }
  
  classifiers = await Promise.all(loadPromises);
  console.log(`✅ All ${numInstances} classification models loaded and ready`);
}
