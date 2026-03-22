chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith("note_")) {
    const data = await chrome.storage.local.get([alarm.name]);
    const note = data[alarm.name];
    if (note) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png', // Fallback, no problem if file is missing in Chrome
        title: note.title || 'TabGroup Notes Rappel',
        message: note.text || 'Temps écoulé !',
        priority: 2
      });
      // Efface l'alarme des données
      note.alarm = null;
      await chrome.storage.local.set({ [alarm.name]: note });
    }
  }
});
