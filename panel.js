// Basic HTML sanitization function to prevent XSS (defense in depth)
const sanitizeInput = (str) => typeof str === 'string' ? str.replace(/<[^>]*>?/gm, '') : '';

const colors = {
  grey: '#DADCE0',
  blue: '#8AB4F8',
  red: '#F28B82',
  yellow: '#FDE293',
  green: '#81C995',
  pink: '#FF8BCB',
  purple: '#D7AEE1',
  cyan: '#78D9EC',
  orange: '#FCAD70'
};

function localizeHtml() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const msg = chrome.i18n.getMessage(key);
    if (msg) el.textContent = msg;
  });
}

// Markdown Helpers
function renderInline(text, parent) {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
  parts.forEach(part => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const b = document.createElement('b');
      b.textContent = part.slice(2, -2);
      parent.appendChild(b);
    } else if (part.startsWith('*') && part.endsWith('*')) {
      const i = document.createElement('i');
      i.textContent = part.slice(1, -1);
      parent.appendChild(i);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  });
}

function renderMdToDom(md, container, onCheckChange) {
  container.replaceChildren();
  if (!md) {
    container.textContent = chrome.i18n.getMessage('placeholder') || '...';
    container.style.opacity = '0.5';
    return;
  }
  container.style.opacity = '1';
  
  const lines = md.split('\n');
  lines.forEach((line, idx) => {
    const lineDiv = document.createElement('div');
    const checkMatch = line.match(/^(-|\*)\s+\[([ xX])\]\s+(.*)/);
    
    if (checkMatch) {
      const isChecked = checkMatch[2].toLowerCase() === 'x';
      lineDiv.className = `md-check-line ${isChecked ? 'checked' : ''}`;
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isChecked;
      cb.addEventListener('change', () => onCheckChange(idx, cb.checked));
      
      const span = document.createElement('span');
      renderInline(checkMatch[3], span);
      
      lineDiv.appendChild(cb);
      lineDiv.appendChild(span);
    } else {
      renderInline(line, lineDiv);
      if (!line) lineDiv.style.minHeight = '1.5em';
    }
    container.appendChild(lineDiv);
  });
}

// Alarm Modal State
let currentAlarmKey = null;

document.addEventListener('DOMContentLoaded', init);

let renderTimeout;
let filterCurrentOnly = false;

function scheduleRender() {
  clearTimeout(renderTimeout);
  renderTimeout = setTimeout(renderGroups, 50);
}

async function init() {
  localizeHtml();
  const settings = await chrome.storage.local.get(['filterCurrentOnly']);
  filterCurrentOnly = settings.filterCurrentOnly || false;
  
  const filterBtn = document.getElementById('filter-btn');
  filterBtn.addEventListener('click', () => {
    filterCurrentOnly = !filterCurrentOnly;
    chrome.storage.local.set({ filterCurrentOnly });
    scheduleRender();
  });

  await renderGroups();
  
  chrome.tabGroups.onUpdated.addListener(scheduleRender);
  chrome.tabGroups.onCreated.addListener(scheduleRender);
  chrome.tabGroups.onRemoved.addListener(scheduleRender);
  
  // React to user switching tabs to update "Focus Mode" view instantly
  chrome.tabs.onActivated.addListener(scheduleRender);
  chrome.tabs.onUpdated.addListener(scheduleRender);
  
  // Set up Alarm Modal mechanics
  const modal = document.getElementById('alarm-modal');
  document.getElementById('cancel-alarm').addEventListener('click', () => modal.style.display = 'none');
  
  document.getElementById('clear-alarm').addEventListener('click', async () => {
     if (currentAlarmKey) {
        const data = await chrome.storage.local.get([currentAlarmKey]);
        if (data[currentAlarmKey]) {
           data[currentAlarmKey].alarm = null;
           await chrome.storage.local.set({ [currentAlarmKey]: data[currentAlarmKey] });
           chrome.alarms.clear(currentAlarmKey);
           scheduleRender();
        }
     }
     modal.style.display = 'none';
  });
  
  document.getElementById('save-alarm').addEventListener('click', async () => {
     const dtVal = document.getElementById('alarm-datetime').value;
     if (!dtVal || !currentAlarmKey) return;
     const timeInMs = new Date(dtVal).getTime();
     if (timeInMs > Date.now()) {
        chrome.alarms.create(currentAlarmKey, { when: timeInMs });
        const data = await chrome.storage.local.get([currentAlarmKey]);
        if (data[currentAlarmKey]) {
           data[currentAlarmKey].alarm = timeInMs;
           await chrome.storage.local.set({ [currentAlarmKey]: data[currentAlarmKey] });
           scheduleRender();
        }
     }
     modal.style.display = 'none';
  });
}

const debounceTimers = {};

async function renderGroups() {
  const container = document.getElementById('groups-container');
  const filterBtn = document.getElementById('filter-btn');
  
  // Update toggle UI
  filterBtn.dataset.active = filterCurrentOnly.toString();
  filterBtn.textContent = filterCurrentOnly ? chrome.i18n.getMessage('filterFocus') : chrome.i18n.getMessage('filterAll');

  let groups = await chrome.tabGroups.query({});
  
  // Query active tab globally in current window to locate active Group ID
  let activeTabGroupId = -1;
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTabs.length > 0 && activeTabs[0].groupId > -1) {
     activeTabGroupId = activeTabs[0].groupId;
  }
  
  // Pre-fetch all needed storage data at once
  const allData = await chrome.storage.local.get(null);
  const totalActiveIds = groups.map(g => g.id.toString());
  
  // Partition Closed/Archived notes globally
  const closedNotes = [];
  for (const key in allData) {
    if (key.startsWith('note_')) {
      const id = key.replace('note_', '');
      if (!totalActiveIds.includes(id)) {
        closedNotes.push({ id, key, data: allData[key] });
      }
    }
  }

  // --- AUTO-RESTORE LOGIC BEFORE FILTERING ---
  for (const group of groups) {
    const storageKey = `note_${group.id}`;
    let noteData = allData[storageKey];
    
    if (noteData === undefined && group.title) {
       const cleanCurrentTabTitle = group.title.replace(/^(📝|📄)\s*/, '');
       if (cleanCurrentTabTitle) {
           const matchIndex = closedNotes.findIndex(cn => {
               const cnData = cn.data;
               const cnText = typeof cnData === 'string' ? cnData : (cnData?.text || '');
               const cnTitle = typeof cnData === 'string' ? '' : (cnData?.title || '');
               const cnClean = cnTitle.replace(/^(📝|📄)\s*/, '');
               return cnClean === cleanCurrentTabTitle && cnText.trim().length > 0;
           });
           
           if (matchIndex !== -1) {
               const matched = closedNotes[matchIndex];
               const matchedText = typeof matched.data === 'string' ? matched.data : matched.data.text;
               
               noteData = { text: matchedText, title: group.title, color: group.color };
               allData[storageKey] = noteData; 
               
               chrome.storage.local.set({ [storageKey]: noteData });
               chrome.storage.local.remove(matched.key);
               closedNotes.splice(matchIndex, 1);
           }
       }
    }
  }

  // --- FILTER DISPLAY IF ACTIVE ---
  let displayedGroups = groups;
  if (filterCurrentOnly) {
     displayedGroups = groups.filter(g => g.id === activeTabGroupId);
  }
  
  const archiveSection = document.getElementById('archive-section');
  
  if (displayedGroups.length === 0) {
    container.replaceChildren();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'no-groups';
    
    if (filterCurrentOnly && activeTabGroupId === -1) {
       msgDiv.textContent = chrome.i18n.getMessage('noGroupCurrent');
    } else {
       msgDiv.textContent = chrome.i18n.getMessage('noGroupGeneral');
    }
    msgDiv.style.whiteSpace = 'pre-line';
    container.appendChild(msgDiv);
    
    archiveSection.style.display = 'none';
    return;
  } else {
    const noGroupsMsg = container.querySelector('.no-groups');
    if (noGroupsMsg) noGroupsMsg.remove();
  }

  // --- RENDER ACTIVE GROUPS ---
  const displayedIds = displayedGroups.map(g => g.id.toString());
  container.querySelectorAll('.group-card').forEach(card => {
     const ta = card.querySelector('textarea');
     if (ta && ta.dataset.groupId && !displayedIds.includes(ta.dataset.groupId)) {
        card.remove();
     }
  });
  
  let domIndex = 0;
  for (const group of displayedGroups) {
    const storageKey = `note_${group.id}`;
    let noteData = allData[storageKey];
    const noteText = typeof noteData === 'string' ? noteData : (noteData?.text || '');
    const hasText = noteText.trim().length > 0;
    
    const hasAlarm = Boolean(noteData?.alarm && noteData.alarm > Date.now());
    const currentTitle = group.title || '';
    const cleanTitle = currentTitle.replace(/^(📝|📄|⏰)\s*/, '');
    const emoji = hasAlarm ? '⏰' : (hasText ? '📝' : '📄');
    const expectedTitle = cleanTitle ? `${emoji} ${cleanTitle}` : emoji;
    
    if (currentTitle !== expectedTitle) {
      chrome.tabGroups.update(group.id, { title: expectedTitle });
      group.title = expectedTitle;
    }
    
    let ta = container.querySelector(`textarea[data-group-id="${group.id}"]`);
    let card = ta ? ta.closest('.group-card') : null;
    
    if (!card) {
      card = document.createElement('div');
      card.className = 'group-card';
      
      const header = document.createElement('div');
      header.className = 'group-header';
      const dot = document.createElement('div');
      dot.className = 'group-color-dot';
      const title = document.createElement('div');
      title.className = 'group-title';
      
      const actions = document.createElement('div');
      actions.className = 'card-header-actions';
      const alarmBtn = document.createElement('button');
      alarmBtn.className = 'btn-alarm';
      alarmBtn.textContent = '⏰';
      alarmBtn.title = chrome.i18n.getMessage('alarmTitle') || 'Définir un rappel';
      alarmBtn.onclick = () => {
         currentAlarmKey = storageKey;
         const dtInput = document.getElementById('alarm-datetime');
         if (noteData?.alarm && noteData.alarm > Date.now()) {
            dtInput.value = new Date(noteData.alarm - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16);
         } else {
            dtInput.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16);
         }
         document.getElementById('alarm-modal').style.display = 'flex';
      };
      actions.appendChild(alarmBtn);
      
      header.appendChild(dot);
      header.appendChild(title);
      header.appendChild(actions);
      
      const noteContainer = document.createElement('div');
      noteContainer.className = 'note-container';
      
      const toolbar = document.createElement('div');
      toolbar.className = 'md-toolbar';
      
      const createToolbarBtn = (icon, titleKey, onClick) => {
         const btn = document.createElement('button');
         btn.className = 'md-toolbar-btn';
         btn.innerHTML = icon;
         btn.title = chrome.i18n.getMessage(titleKey) || titleKey;
         btn.addEventListener('mousedown', (e) => {
             e.preventDefault(); 
             onClick();
         });
         return btn;
      };
      
      const mdView = document.createElement('div');
      mdView.className = 'md-view';
      mdView.style.display = 'block';
      
      ta = document.createElement('textarea');
      ta.className = 'note-textarea';
      ta.placeholder = chrome.i18n.getMessage('placeholder');
      ta.dataset.groupId = group.id;
      ta.style.display = 'none'; // text area is hidden by default
      
      const insertMd = (prefix, suffix = '') => {
          const start = ta.selectionStart;
          const end = ta.selectionEnd;
          const selectedText = ta.value.substring(start, end);
          ta.value = ta.value.substring(0, start) + prefix + selectedText + suffix + ta.value.substring(end);
          ta.selectionStart = ta.selectionEnd = start + prefix.length + selectedText.length;
          ta.focus();
          ta.dispatchEvent(new Event('input'));
      };
      
      const insertLinePrefix = (prefix) => {
          const start = ta.selectionStart;
          let lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
          ta.value = ta.value.substring(0, lineStart) + prefix + ta.value.substring(lineStart);
          ta.selectionStart = ta.selectionEnd = start + prefix.length;
          ta.focus();
          ta.dispatchEvent(new Event('input'));
      };

      toolbar.appendChild(createToolbarBtn('<b>B</b>', 'toolbarBold', () => insertMd('**', '**')));
      toolbar.appendChild(createToolbarBtn('<i>I</i>', 'toolbarItalic', () => insertMd('*', '*')));
      toolbar.appendChild(createToolbarBtn('☑', 'toolbarChecklist', () => insertLinePrefix('- [ ] ')));
      
      const syncCheckboxes = (lineIdx, isChecked) => {
         const lines = ta.value.split('\n');
         const match = lines[lineIdx].match(/^((-|\*)\s+\[)[ xX](\]\s+.*)/);
         if (match) {
            lines[lineIdx] = `${match[1]}${isChecked ? 'x' : ' '}${match[3]}`;
            ta.value = lines.join('\n');
            ta.dispatchEvent(new Event('input')); // trigger save
            renderMdToDom(ta.value, mdView, syncCheckboxes);
         }
      };
      
      mdView.addEventListener('click', (e) => {
         if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') return;
         mdView.style.display = 'none';
         ta.style.display = 'block';
         toolbar.style.display = 'flex';
         ta.focus();
      });
      
      ta.addEventListener('blur', () => {
         ta.style.display = 'none';
         toolbar.style.display = 'none';
         mdView.style.display = 'block';
         renderMdToDom(ta.value, mdView, syncCheckboxes);
      });
      
      ta.addEventListener('keydown', (e) => {
         if (e.key === 'Enter') {
            const start = ta.selectionStart;
            const textToCursor = ta.value.substring(0, start);
            const lineStart = textToCursor.lastIndexOf('\n') + 1;
            const currentLine = textToCursor.substring(lineStart);
            const checkMatch = currentLine.match(/^((-|\*)\s+\[[ xX]\]\s+)(.*)$/);
            
            if (checkMatch) {
                e.preventDefault();
                if (checkMatch[3].trim() === '') {
                    // Empty checklist item -> remove it and just insert newline
                    ta.value = ta.value.substring(0, lineStart) + '\n' + ta.value.substring(start);
                    ta.selectionStart = ta.selectionEnd = lineStart + 1;
                } else {
                    // Continue checklist
                    const newCheck = '\n- [ ] ';
                    ta.value = ta.value.substring(0, start) + newCheck + ta.value.substring(start);
                    ta.selectionStart = ta.selectionEnd = start + newCheck.length;
                }
                ta.dispatchEvent(new Event('input'));
            }
         }
      });
      
      ta.addEventListener('input', (e) => {
        const val = e.target.value;
        if (debounceTimers[group.id]) clearTimeout(debounceTimers[group.id]);
        
        debounceTimers[group.id] = setTimeout(async () => {
          const isNowHasText = val.trim().length > 0;
          const grpCleanTitle = (group.title || '').replace(/^(📝|📄|⏰)\s*/, '');
          const currentData = await chrome.storage.local.get([storageKey]);
          const currentAlarm = currentData[storageKey]?.alarm;
          const isAlarm = Boolean(currentAlarm && currentAlarm > Date.now());
          const newEmoji = isAlarm ? '⏰' : (isNowHasText ? '📝' : '📄');
          const newExpectedTitle = grpCleanTitle ? `${newEmoji} ${grpCleanTitle}` : newEmoji;
          
          if (group.title !== newExpectedTitle) {
             chrome.tabGroups.update(group.id, { title: newExpectedTitle });
             group.title = newExpectedTitle;
          }
          
          const safeVal = sanitizeInput(val);
          noteData = { text: safeVal, title: newExpectedTitle, color: group.color, alarm: currentAlarm };
          chrome.storage.local.set({ [storageKey]: noteData });
        }, 400);
      });
      
      noteContainer.appendChild(toolbar);
      noteContainer.appendChild(mdView);
      noteContainer.appendChild(ta);
      
      card.appendChild(header);
      card.appendChild(noteContainer);
    }
    
    card.querySelector('.group-title').textContent = group.title || `${chrome.i18n.getMessage('unnamedGroup')} (${group.color})`;
    card.querySelector('.group-color-dot').style.backgroundColor = colors[group.color] || colors.grey;
    
    const alarmBtn = card.querySelector('.btn-alarm');
    if (alarmBtn) alarmBtn.className = hasAlarm ? 'btn-alarm active' : 'btn-alarm';
    
    if (document.activeElement !== ta && noteText !== undefined) {
       ta.value = noteText;
       const mdView = card.querySelector('.md-view');
       if (mdView && ta.style.display === 'none') {
           const syncCb = (lineIdx, isChecked) => {
              const lines = ta.value.split('\n');
              const match = lines[lineIdx].match(/^((-|\*)\s+\[)[ xX](\]\s+.*)/);
              if (match) {
                 lines[lineIdx] = `${match[1]}${isChecked ? 'x' : ' '}${match[3]}`;
                 ta.value = lines.join('\n');
                 ta.dispatchEvent(new Event('input'));
                 renderMdToDom(ta.value, mdView, syncCb);
              }
           };
           renderMdToDom(noteText, mdView, syncCb);
       }
    }
    
    const expectedChild = container.children[domIndex];
    if (expectedChild !== card) {
       container.insertBefore(card, expectedChild);
    }
    domIndex++;
  }

  // --- RENDER ARCHIVED GROUPS ---
  const archiveContainer = document.getElementById('archived-container');
  
  const validClosedNotes = closedNotes.filter(cn => {
      const txt = typeof cn.data === 'string' ? cn.data : (cn.data?.text || '');
      return txt.trim().length > 0;
  });
  
  // Hide archives dynamically if Focus Mode is ON
  if (filterCurrentOnly || validClosedNotes.length === 0) {
      archiveSection.style.display = 'none';
      if (!filterCurrentOnly) archiveContainer.replaceChildren();
  } else {
      archiveSection.style.display = 'block';
      
      const existingArchiveIds = validClosedNotes.map(cn => cn.id);
      archiveContainer.querySelectorAll('.group-card').forEach(card => {
         const ta = card.querySelector('textarea');
         if (ta && !existingArchiveIds.includes(ta.dataset.archiveId)) card.remove();
      });
      
      let archiveDomIndex = 0;
      for (const cn of validClosedNotes) {
          const txt = typeof cn.data === 'string' ? cn.data : (cn.data?.text || '');
          const titleStr = typeof cn.data === 'string' ? cn.data.substring(0,20)+'...' : (cn.data?.title || chrome.i18n.getMessage('closedGroup'));
          const colorStr = typeof cn.data === 'string' ? 'grey' : (cn.data?.color || 'grey');
          
          let card = archiveContainer.querySelector(`textarea[data-archive-id="${cn.id}"]`)?.closest('.group-card');
          if (!card) {
             card = document.createElement('div');
             card.className = 'group-card';
             card.style.opacity = '0.85'; 
             
             const header = document.createElement('div');
             header.className = 'group-header';
             const dot = document.createElement('div');
             dot.className = 'group-color-dot';
             const titleEl = document.createElement('div');
             titleEl.className = 'group-title';
             
             const actions = document.createElement('div');
             actions.className = 'card-header-actions';
             const delBtn = document.createElement('button');
             delBtn.className = 'delete-btn';
             delBtn.textContent = '🗑️';
             delBtn.title = chrome.i18n.getMessage('deleteNote');
             delBtn.onclick = () => {
                 chrome.storage.local.remove(cn.key);
                 card.remove();
                 if (archiveContainer.children.length === 0) archiveSection.style.display = 'none';
             };
             
             actions.appendChild(delBtn);
             header.appendChild(dot);
             header.appendChild(titleEl);
             header.appendChild(actions);
             
             const ta = document.createElement('textarea');
             ta.className = 'note-textarea';
             ta.dataset.archiveId = cn.id;
             
             ta.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                   const start = ta.selectionStart;
                   const textToCursor = ta.value.substring(0, start);
                   const lineStart = textToCursor.lastIndexOf('\n') + 1;
                   const currentLine = textToCursor.substring(lineStart);
                   const checkMatch = currentLine.match(/^((-|\*)\s+\[[ xX]\]\s+)(.*)$/);
                   
                   if (checkMatch) {
                       e.preventDefault();
                       if (checkMatch[3].trim() === '') {
                           ta.value = ta.value.substring(0, lineStart) + '\n' + ta.value.substring(start);
                           ta.selectionStart = ta.selectionEnd = lineStart + 1;
                       } else {
                           const newCheck = '\n- [ ] ';
                           ta.value = ta.value.substring(0, start) + newCheck + ta.value.substring(start);
                           ta.selectionStart = ta.selectionEnd = start + newCheck.length;
                       }
                       ta.dispatchEvent(new Event('input'));
                   }
                }
             });
             
             ta.addEventListener('input', (e) => {
                const val = sanitizeInput(e.target.value);
                if (debounceTimers[cn.id]) clearTimeout(debounceTimers[cn.id]);
                debounceTimers[cn.id] = setTimeout(() => {
                    chrome.storage.local.set({ [cn.key]: { text: val, title: titleStr, color: colorStr } });
                }, 400);
             });
             
             card.appendChild(header);
             card.appendChild(ta);
          }
          
          card.querySelector('.group-title').textContent = titleStr;
          card.querySelector('.group-color-dot').style.backgroundColor = colors[colorStr] || colors.grey;
          const ta = card.querySelector('textarea');
          if (document.activeElement !== ta) ta.value = txt;
          
          const expectedArchiveChild = archiveContainer.children[archiveDomIndex];
          if (expectedArchiveChild !== card) {
             archiveContainer.insertBefore(card, expectedArchiveChild);
          }
          archiveDomIndex++;
      }
  }
}
