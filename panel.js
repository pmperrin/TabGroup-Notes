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

document.addEventListener('DOMContentLoaded', init);

let renderTimeout;
let filterCurrentOnly = false;

function scheduleRender() {
  clearTimeout(renderTimeout);
  renderTimeout = setTimeout(renderGroups, 50);
}

async function init() {
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
}

const debounceTimers = {};

async function renderGroups() {
  const container = document.getElementById('groups-container');
  const filterBtn = document.getElementById('filter-btn');
  
  // Update toggle UI
  filterBtn.dataset.active = filterCurrentOnly.toString();
  filterBtn.innerHTML = filterCurrentOnly ? '🎯 Focus Actif' : '👁️ Tous';

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
    if (filterCurrentOnly && activeTabGroupId === -1) {
       container.innerHTML = '<div class="no-groups">L\'onglet actuel n\'est dans aucun groupe.<br>Désactivez le focus (👁️ Tous) pour voir vos autres notes.</div>';
    } else {
       container.innerHTML = '<div class="no-groups">Aucun groupe d\'onglets actif.<br>Créez-en un dans Chrome pour ajouter des notes !</div>';
    }
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
  
  for (const group of displayedGroups) {
    const storageKey = `note_${group.id}`;
    let noteData = allData[storageKey];
    const noteText = typeof noteData === 'string' ? noteData : (noteData?.text || '');
    const hasText = noteText.trim().length > 0;
    
    const currentTitle = group.title || '';
    const cleanTitle = currentTitle.replace(/^(📝|📄)\s*/, '');
    const emoji = hasText ? '📝' : '📄';
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
      
      header.appendChild(dot);
      header.appendChild(title);
      
      ta = document.createElement('textarea');
      ta.className = 'note-textarea';
      ta.placeholder = 'Entrez vos tâches / post-its ici...';
      ta.dataset.groupId = group.id;
      
      ta.addEventListener('input', (e) => {
        const val = e.target.value;
        if (debounceTimers[group.id]) clearTimeout(debounceTimers[group.id]);
        
        debounceTimers[group.id] = setTimeout(() => {
          const isNowHasText = val.trim().length > 0;
          const grpCleanTitle = (group.title || '').replace(/^(📝|📄)\s*/, '');
          const newEmoji = isNowHasText ? '📝' : '📄';
          const newExpectedTitle = grpCleanTitle ? `${newEmoji} ${grpCleanTitle}` : newEmoji;
          
          if (group.title !== newExpectedTitle) {
             chrome.tabGroups.update(group.id, { title: newExpectedTitle });
             group.title = newExpectedTitle;
          }
          
          chrome.storage.local.set({ 
            [storageKey]: { text: val, title: newExpectedTitle, color: group.color } 
          });
        }, 400);
      });
      
      card.appendChild(header);
      card.appendChild(ta);
    }
    
    card.querySelector('.group-title').textContent = group.title || `Groupe sans nom (${group.color})`;
    card.querySelector('.group-color-dot').style.backgroundColor = colors[group.color] || colors.grey;
    if (document.activeElement !== ta && noteText !== undefined) ta.value = noteText;
    container.appendChild(card);
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
      if (!filterCurrentOnly) archiveContainer.innerHTML = '';
  } else {
      archiveSection.style.display = 'block';
      
      const existingArchiveIds = validClosedNotes.map(cn => cn.id);
      archiveContainer.querySelectorAll('.group-card').forEach(card => {
         const ta = card.querySelector('textarea');
         if (ta && !existingArchiveIds.includes(ta.dataset.archiveId)) card.remove();
      });
      
      for (const cn of validClosedNotes) {
          const txt = typeof cn.data === 'string' ? cn.data : (cn.data?.text || '');
          const titleStr = typeof cn.data === 'string' ? cn.data.substring(0,20)+'...' : (cn.data?.title || 'Groupe fermé');
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
             delBtn.innerHTML = '🗑️';
             delBtn.title = 'Supprimer cette note définitivement';
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
             
             ta.addEventListener('input', (e) => {
                const val = e.target.value;
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
          
          archiveContainer.appendChild(card);
      }
  }
}
