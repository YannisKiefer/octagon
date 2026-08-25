const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function runSmokeTest() {
  console.log('🚀 STARTING PENTAGON-LEVEL SMOKE TEST...');
  
  const farmBrainPath = path.join(__dirname, 'farm-brain.js');
  const duration = 2; // 2 minutes for smoke test
  
  const child = spawn('node', [farmBrainPath, 'warmup', `--duration=${duration}`, '--device=phone1', '--dryRun', '--logActions'], {
    env: { ...process.env, FARM_DRY_RUN: '1', FARM_LOG_ACTIONS: '1' }
  });
  
  let output = '';
  let errors = '';

  child.stdout.on('data', (data) => {
    output += data.toString();
    process.stdout.write(data);
  });

  child.stderr.on('data', (data) => {
    errors += data.toString();
  });

  return new Promise((resolve) => {
    child.on('close', (code) => {
      console.log(`\n\n📊 ANALYZING SMOKE TEST RESULTS (Exit Code: ${code})...`);
      
      const results = {
        passed: code === 0,
        hasMicroGestures: output.includes('PAUSEMIDSWIPE') || output.includes('DOUBLEBACK') || output.includes('SCROLLTHROUGH'),
        hasJitter: false,
        totalSwipes: (output.match(/SWIPENEXT/g) || []).length,
        errors: errors.length > 0
      };

      // Check jitter by looking at timestamps in output if possible, 
      // but for now, we'll just check if the micro-gestures appeared.
      
      if (results.passed && results.hasMicroGestures && results.totalSwipes > 0) {
        console.log('✅ SMOKE TEST PASSED: Micro-gestures detected and logic is stable.');
      } else {
        console.log('❌ SMOKE TEST FAILED: Check logs.');
        console.log(results);
      }
      
      resolve(results);
    });
  });
}

runSmokeTest().catch(console.error);
