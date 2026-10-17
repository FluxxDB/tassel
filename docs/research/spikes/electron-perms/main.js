const { app, systemPreferences, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, 'results.txt');
const log = (s) => fs.appendFileSync(out, s + '\n');
app.whenReady().then(async () => {
  fs.writeFileSync(out, '');
  log('camera before: ' + systemPreferences.getMediaAccessStatus('camera'));
  log('camera granted: ' + (await systemPreferences.askForMediaAccess('camera')));
  log('microphone granted: ' + (await systemPreferences.askForMediaAccess('microphone')));
  log('screen before: ' + systemPreferences.getMediaAccessStatus('screen'));
  try {
    const s = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 8, height: 8 } });
    log('screen sources: ' + s.length);
  } catch (e) { log('screen error: ' + e.message); }
  log('screen after: ' + systemPreferences.getMediaAccessStatus('screen'));
  log('done');
  app.quit();
});
