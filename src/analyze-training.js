import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyMessage } from './classifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRAINING_DATA_FILE = path.join(__dirname, '..', 'training-data.json');

async function analyzeTrainingData() {
  console.log('📊 Analyzing Training Data...\n');
  
  // Load training data
  let trainingData = [];
  try {
    const data = fs.readFileSync(TRAINING_DATA_FILE, 'utf8');
    trainingData = JSON.parse(data);
    console.log(`✅ Loaded ${trainingData.length} training examples\n`);
  } catch (error) {
    console.error('❌ Error loading training data:', error.message);
    process.exit(1);
  }
  
  if (trainingData.length === 0) {
    console.log('❌ No training data found!');
    process.exit(1);
  }
  
  // Re-classify each message and collect confidence scores
  console.log('🔄 Re-classifying all messages to get confidence scores...\n');
  
  const results = {
    shouldRespond: [],
    shouldIgnore: []
  };
  
  for (let i = 0; i < trainingData.length; i++) {
    const example = trainingData[i];
    const classification = await classifyMessage(example.message, `analyze_${i}`);
    
    results[example.shouldRespond ? 'shouldRespond' : 'shouldIgnore'].push({
      message: example.message,
      classification: classification,
      classifierSays: example.classifierSays
    });
    
    process.stdout.write(`\rProgress: ${i + 1}/${trainingData.length}`);
  }
  
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Calculate statistics
  const shouldRespond = results.shouldRespond;
  const shouldIgnore = results.shouldIgnore;
  
  const correctRespond = shouldRespond.filter(r => r.classification !== 'ignore').length;
  const incorrectRespond = shouldRespond.filter(r => r.classification === 'ignore').length;
  
  const correctIgnore = shouldIgnore.filter(r => r.classification === 'ignore').length;
  const incorrectIgnore = shouldIgnore.filter(r => r.classification !== 'ignore').length;
  
  console.log('📊 TRAINING DATA ANALYSIS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('**Messages that SHOULD get responses:**');
  console.log(`  Total: ${shouldRespond.length}`);
  console.log(`  ✅ Correctly classified: ${correctRespond} (${((correctRespond / shouldRespond.length) * 100).toFixed(1)}%)`);
  console.log(`  ❌ Incorrectly ignored: ${incorrectRespond} (${((incorrectRespond / shouldRespond.length) * 100).toFixed(1)}%)\n`);
  
  console.log('**Messages that SHOULD be ignored:**');
  console.log(`  Total: ${shouldIgnore.length}`);
  console.log(`  ✅ Correctly ignored: ${correctIgnore} (${((correctIgnore / shouldIgnore.length) * 100).toFixed(1)}%)`);
  console.log(`  ❌ Incorrectly responded: ${incorrectIgnore} (${((incorrectIgnore / shouldIgnore.length) * 100).toFixed(1)}%)\n`);
  
  const accuracy = ((correctRespond + correctIgnore) / trainingData.length) * 100;
  console.log(`**Overall Accuracy: ${accuracy.toFixed(1)}%**\n`);
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Show false negatives (should respond but didn't)
  if (incorrectRespond > 0) {
    console.log('❌ FALSE NEGATIVES (Should respond but classifier ignored):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const falseNegatives = shouldRespond.filter(r => r.classification === 'ignore');
    falseNegatives.forEach((fn, idx) => {
      console.log(`${idx + 1}. "${fn.message}"`);
      console.log(`   Classified as: ${fn.classification}\n`);
    });
  }
  
  // Show false positives (should ignore but didn't)
  if (incorrectIgnore > 0) {
    console.log('\n❌ FALSE POSITIVES (Should ignore but classifier responded):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const falsePositives = shouldIgnore.filter(r => r.classification !== 'ignore');
    falsePositives.forEach((fp, idx) => {
      console.log(`${idx + 1}. "${fp.message}"`);
      console.log(`   Classified as: ${fp.classification}\n`);
    });
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('💡 RECOMMENDATIONS:\n');
  
  console.log(`📊 Overall Accuracy: ${accuracy.toFixed(1)}% (${correctRespond + correctIgnore}/${trainingData.length} correct)\n`);
  
  if (incorrectRespond > incorrectIgnore) {
    console.log('⚠️  Classifier is TOO STRICT - many valid questions are being ignored');
    console.log('   Consider:');
    console.log('   1. LOWERING the confidence threshold from current to 0.35-0.4');
    console.log('   2. Adding more positive patterns to looksLikeQuestion()');
    console.log('   3. Reviewing filters that might be too aggressive\n');
  } else if (incorrectIgnore > incorrectRespond) {
    console.log('⚠️  Classifier is TOO LOOSE - responding to things it shouldn\'t');
    console.log('   Consider:');
    console.log('   1. RAISING the confidence threshold from current to 0.6-0.7');
    console.log('   2. Adding more filters to looksLikeQuestion()');
    console.log('   3. Strengthening pre-classification filters\n');
  } else {
    console.log('✅ Classifier balance looks reasonable!');
    console.log('   Fine-tune by reviewing false positives/negatives above.\n');
  }
  
  if (accuracy < 70) {
    console.log('⚠️  Accuracy is LOW (<70%) - significant improvements needed');
  } else if (accuracy < 85) {
    console.log('⚠️  Accuracy is MODERATE (70-85%) - room for improvement');
  } else {
    console.log('✅ Accuracy is GOOD (>85%) - classifier is performing well');
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  process.exit(0);
}

analyzeTrainingData();
