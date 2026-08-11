(function () {
  'use strict';

  var FOLDER_TABLE = 'document_folders';
  var adminFolders = [];
  var adminFolderSchemaAvailable = false;
  var frontFolders = [];
  var frontFolderLoadComplete = false;
  var adminInstalled = false;
  var frontInstalled = false;
  var refreshInFlight = false;

  function injectStyles() {
    if (document.getElementById('document-folder-styles')) return;
    var style = document.createElement('style');
    style.id = 'document-folder-styles';
    style.textContent = [
      '.doc-folder{border:1px solid rgba(2,53,90,.10);border-radius:10px;background:rgba(249,247,241,.48);margin:8px 0;overflow:hidden;}',
      '.doc-folder+.doc-folder{margin-top:8px;}',
      '.doc-folder>summary{list-style:none;display:flex;align-items:center;gap:9px;padding:10px 12px;cursor:pointer;color:#02355A;font-size:12.5px;font-weight:600;user-select:none;}',
      '.doc-folder>summary::-webkit-details-marker{display:none;}',
      '.doc-folder>summary:before{content:"▸";width:12px;color:#7a9ab8;font-size:11px;transition:transform .15s ease;}',
      '.doc-folder[open]>summary:before{transform:rotate(90deg);}',
      '.doc-folder-icon{width:17px;height:17px;display:inline-flex;align-items:center;justify-content:center;color:#3680CE;flex:0 0 auto;}',
      '.doc-folder-icon .icon{width:16px;height:16px;}',
      '.doc-folder-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.doc-folder-count{font-size:10.5px;font-weight:500;color:#7a9ab8;background:#fff;border:1px solid rgba(2,53,90,.08);border-radius:100px;padding:2px 7px;}',
      '.doc-folder-body{padding:0 10px 10px 30px;}',
      '.doc-folder-body>.link-group:empty{display:none;}',
      '.doc-file-actions{display:flex;align-items:center;gap:5px;margin-left:auto;flex-shrink:0;}',
      '.doc-file-btn{border:1px solid rgba(2,53,90,.13);background:#fff;color:#02355A;border-radius:100px;padding:5px 8px;font-size:10.5px;font-weight:600;text-decoration:none;white-space:nowrap;}',
      '.doc-file-btn:hover{border-color:#3680CE;color:#3680CE;}',
      '.doc-file-item .link-report-btn{margin-left:1px;}',
      '.folder-migration-note{margin:0 0 14px;padding:10px 12px;border:1px solid rgba(181,122,13,.25);background:#fff8e7;border-radius:9px;color:#7d5b12;font-size:11.5px;}',
      '.doc-folder-admin{border:1px solid rgba(2,53,90,.12);border-radius:10px;margin:10px 14px;background:#fbfcfe;overflow:hidden;}',
      '.doc-folder-admin .doc-folder-admin{margin:8px 0 0 18px;background:#fff;}',
      '.doc-folder-admin-header{display:flex;align-items:center;gap:7px;padding:8px 10px;background:#f6f8fb;border-bottom:1px solid rgba(2,53,90,.08);}',
      '.doc-folder-admin-header .folder-glyph{color:#3680CE;font-size:15px;line-height:1;}',
      '.doc-folder-admin-header .f-folder-name{flex:1;min-width:120px;padding:6px 8px;border:1px solid rgba(2,53,90,.18);border-radius:6px;font:inherit;font-size:12px;color:#2c4a62;background:#fff;}',
      '.doc-folder-admin-header .folder-count{font-size:10.5px;color:#7a9ab8;white-space:nowrap;}',
      '.doc-folder-admin-actions{display:flex;align-items:center;gap:3px;flex-wrap:wrap;justify-content:flex-end;}',
      '.doc-folder-admin-body{padding:4px 0 8px;}',
      '.doc-folder-admin-children{padding-right:0;}',
      '.link-row.folder-enabled{grid-template-columns:16px minmax(130px,1fr) minmax(160px,1fr) 145px 90px 105px 104px;}',
      '.link-row .f-folder{width:100%;padding:6px 8px;border:1px solid rgba(2,53,90,.18);border-radius:6px;font-family:inherit;font-size:11.5px;color:#2c4a62;background:#fff;}',
      '.link-row .file-actions{display:flex;gap:2px;align-items:center;justify-content:flex-end;}',
      '@media(max-width:1100px){.link-row.folder-enabled{grid-template-columns:16px 1fr 1fr 120px 82px 90px 88px;}.doc-file-btn{padding:4px 7px;}}'
    ].join('');
    document.head.appendChild(style);
  }

  function missingRelation(error) {
    if (!error) return false;
    var msg = String(error.message || error.details || error.hint || '');
    return error.code === '42P01' || /document_folders|folder_id/i.test(msg) && /does not exist|schema cache|column|relation/i.test(msg);
  }

  function downloadUrl(url, label) {
    if (!url) return '#';
    if (url.indexOf('/storage/v1/object/public/') !== -1) {
      var sep = url.indexOf('?') === -1 ? '?' : '&';
      return url + sep + 'download=' + encodeURIComponent((label || 'document').replace(/\.pdf$/i, '') + '.pdf');
    }
    return url;
  }

  function folderChildren(folders, parentId) {
    return folders.filter(function (f) {
      return (f.parent_folder_id || null) === (parentId || null);
    }).sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0) || String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  function descendantFolderIds(folderId, folders) {
    var ids = [];
    function walk(id) {
      folderChildren(folders, id).forEach(function (child) {
        ids.push(child.id);
        walk(child.id);
      });
    }
    walk(folderId);
    return ids;
  }

  function folderItemCount(folderId, folders, links) {
    var ids = [folderId].concat(descendantFolderIds(folderId, folders));
    return links.filter(function (l) { return ids.indexOf(l.folder_id) !== -1; }).length;
  }

  function folderPath(folder, folders) {
    var path = [folder.name || 'Untitled folder'];
    var seen = {};
    var parentId = folder.parent_folder_id;
    while (parentId && !seen[parentId]) {
      seen[parentId] = true;
      var parent = folders.find(function (f) { return f.id === parentId; });
      if (!parent) break;
      path.unshift(parent.name || 'Untitled folder');
      parentId = parent.parent_folder_id;
    }
    return path.join(' / ');
  }

  function folderOptionsHtml(subsectionId, currentId) {
    var folders = adminFolders.filter(function (f) { return f.subsection_id === subsectionId; });
    folders.sort(function (a, b) { return folderPath(a, folders).localeCompare(folderPath(b, folders)); });
    return '<option value=""' + (!currentId ? ' selected' : '') + '>Root of subsection</option>' + folders.map(function (f) {
      return '<option value="' + escHtml(f.id) + '"' + (f.id === currentId ? ' selected' : '') + '>' + escHtml(folderPath(f, folders)) + '</option>';
    }).join('');
  }

  function installFront() {
    if (frontInstalled || typeof renderSubsection !== 'function' || typeof renderLinkItem !== 'function' || typeof sb === 'undefined') return false;
    frontInstalled = true;
    injectStyles();

    var originalRenderLinkItem = renderLinkItem;

    renderLinkItem = function (link) {
      if (!link || !link.file_url) return originalRenderLinkItem(link);
      var iconId = link.icon || 'i-link';
      var iconHtml = '<div class="link-icon"><svg class="icon"><use href="#' + escHtml(iconId) + '"></use></svg></div>';
      var isLive = link.status === 'live' && link.file_url;
      var pendingBadge = !isLive ? ' <span class="pending">' + escHtml(link.pending_note || 'Pending') + '</span>' : '';
      var reportBtn = '<button class="link-report-btn" data-report-id="' + escHtml(link.id) + '" data-report-label="' + escHtml(link.label) + '" title="Report a problem with this link" onclick="event.preventDefault();event.stopPropagation();reportBrokenLink(this);"><svg class="icon"><use href="#i-flag"></use></svg></button>';
      var inner = iconHtml
        + '<div class="link-content"><div class="link-label">' + escHtml(link.label) + pendingBadge + '</div>'
        + (link.sub_label ? '<div class="link-sub">' + escHtml(link.sub_label) + '</div>' : '')
        + '</div>';
      if (!isLive) return '<div class="link-item doc-file-item" style="cursor:default;" data-link-id="' + escHtml(link.id) + '">' + inner + reportBtn + '</div>';
      return '<div class="link-item doc-file-item" data-link-id="' + escHtml(link.id) + '">' + inner
        + '<div class="doc-file-actions">'
        + '<a class="doc-file-btn" href="' + escHtml(link.file_url) + '" target="_blank" rel="noopener">Preview ↗</a>'
        + '<a class="doc-file-btn" href="' + escHtml(downloadUrl(link.file_url, link.label)) + '" download>Download ↓</a>'
        + '</div>' + reportBtn + '</div>';
    };

    function renderFrontFolder(folder, subFolders, subLinks, depth) {
      var directLinks = subLinks.filter(function (l) { return l.folder_id === folder.id; })
        .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
      var children = folderChildren(subFolders, folder.id);
      var count = folderItemCount(folder.id, subFolders, subLinks);
      var directHtml = directLinks.length ? '<div class="link-group">' + directLinks.map(renderLinkItem).join('') + '</div>' : '';
      var childrenHtml = children.map(function (child) { return renderFrontFolder(child, subFolders, subLinks, depth + 1); }).join('');
      return '<details class="doc-folder" data-folder-id="' + escHtml(folder.id) + '">'
        + '<summary><span class="doc-folder-icon"><svg class="icon"><use href="#i-folder"></use></svg></span>'
        + '<span class="doc-folder-name">' + escHtml(folder.name) + '</span>'
        + '<span class="doc-folder-count">' + count + (count === 1 ? ' item' : ' items') + '</span></summary>'
        + '<div class="doc-folder-body">' + directHtml + childrenHtml + '</div></details>';
    }

    renderSubsection = function (ouSlug, sub, allLinks) {
      var subLinks = allLinks.filter(function (l) { return l.subsection_id === sub.id; })
        .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
      var showsRequestorPortal = (ouSlug === 'apac' || ouSlug === 'af') && sub.name.trim().toLowerCase() === 'matters';
      if (showsRequestorPortal) {
        subLinks = subLinks.filter(function (l) { return !(l.url && l.url.indexOf('checkbox.ai/app/ticketing/portal') !== -1); });
      }
      var subFolders = frontFolders.filter(function (f) { return f.subsection_id === sub.id; });
      var rootLinks = subLinks.filter(function (l) { return !l.folder_id || !subFolders.some(function (f) { return f.id === l.folder_id; }); });
      var roots = folderChildren(subFolders, null);
      var subId = ouSlug + '-' + slugify(sub.name);
      var countLabel = subLinks.length + (subLinks.length === 1 ? ' item' : ' items');
      var embedHtml = showsRequestorPortal
        ? '<div class="embedded-portal">'
          + '<div class="embedded-portal-label"><svg class="icon" width="14" height="14"><use href="#i-link"></use></svg> Requestor Portal'
          + '<a href="https://pepsico.checkbox.ai/app/ticketing/portal?source=platform" target="_blank" rel="noopener" class="embedded-portal-openlink">Open in new tab ↗</a></div>'
          + '<iframe class="embedded-portal-frame" src="https://pepsico.checkbox.ai/app/ticketing/portal?source=platform" loading="lazy" title="Checkbox Requestor Portal"></iframe></div>'
        : '';
      var contentHtml = (rootLinks.length ? '<div class="link-group">' + rootLinks.map(renderLinkItem).join('') + '</div>' : '')
        + roots.map(function (folder) { return renderFrontFolder(folder, subFolders, subLinks, 0); }).join('');
      if (!contentHtml && !embedHtml) contentHtml = '<div class="link-group"></div>';
      return '<div class="subsection" id="' + escHtml(subId) + '">'
        + '<button class="sub-trigger" onclick="toggleSub(\'' + subId + '\')"><span class="sub-name">' + escHtml(sub.name) + '</span>'
        + '<span class="sub-count">' + countLabel + '</span>'
        + '<div class="sub-chev"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div></button>'
        + '<div class="sub-body">' + contentHtml + embedHtml + '</div></div>';
    };

    async function refreshFrontFolders() {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        var results = await Promise.all([
          sb.from(FOLDER_TABLE).select('*').order('sort_order'),
          sb.from('operating_units').select('*').order('sort_order'),
          sb.from('subsections').select('*').order('sort_order'),
          sb.from('links').select('*').order('sort_order'),
          sb.from('destinations').select('*')
        ]);
        var folderRes = results[0], ousRes = results[1], subsRes = results[2], linksRes = results[3], destRes = results[4];
        if (folderRes.error) {
          if (!missingRelation(folderRes.error)) console.warn('Folder load failed:', folderRes.error);
          frontFolders = [];
          frontFolderLoadComplete = true;
          return;
        }
        if (ousRes.error || subsRes.error || linksRes.error) return;
        frontFolders = folderRes.data || [];
        frontFolderLoadComplete = true;
        var links = linksRes.data || [];
        if (!destRes.error && destRes.data) {
          var destById = {};
          destRes.data.forEach(function (d) { destById[d.id] = d.url; });
          links.forEach(function (l) { if (l.destination_id && destById[l.destination_id]) l.url = destById[l.destination_id]; });
        }
        (ousRes.data || []).forEach(function (ou) {
          var existing = document.getElementById('panel-' + ou.slug);
          if (!existing || typeof renderOuPanel !== 'function') return;
          var wrapper = document.createElement('div');
          wrapper.innerHTML = renderOuPanel(ou, subsRes.data || [], links).trim();
          if (wrapper.firstElementChild) existing.replaceWith(wrapper.firstElementChild);
        });
        window.dispatchEvent(new Event('content-loaded'));
      } catch (error) {
        console.warn('Folder refresh failed:', error);
      } finally {
        refreshInFlight = false;
      }
    }

    window.addEventListener('content-loaded', function () {
      if (!frontFolderLoadComplete) setTimeout(refreshFrontFolders, 0);
    });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(refreshFrontFolders, 0); }, { once: true });
    } else {
      setTimeout(refreshFrontFolders, 0);
    }
    return true;
  }

  function installAdmin() {
    if (adminInstalled || typeof loadContentTab !== 'function' || typeof renderOuDetail !== 'function' || typeof sb === 'undefined') return false;
    adminInstalled = true;
    injectStyles();

    loadContentTab = async function () {
      var results = await Promise.all([
        sb.from('operating_units').select('*').order('sort_order'),
        sb.from('subsections').select('*').order('sort_order'),
        sb.from('links').select('*').order('sort_order'),
        sb.from(FOLDER_TABLE).select('*').order('sort_order')
      ]);
      var ousRes = results[0], subsRes = results[1], linksRes = results[2], foldersRes = results[3];
      OUS = ousRes.data || [];
      SUBS = subsRes.data || [];
      LINKS = linksRes.data || [];
      adminFolderSchemaAvailable = !foldersRes.error;
      adminFolders = foldersRes.data || [];
      if (foldersRes.error && !missingRelation(foldersRes.error)) console.warn('Could not load document folders:', foldersRes.error);
      renderOuList();
      if (activeOuId) renderOuDetail(activeOuId);
    };

    function adminFolderHtml(folder, subId, subFolders, links, depth) {
      var directLinks = links.filter(function (l) { return l.folder_id === folder.id; })
        .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
      var children = folderChildren(subFolders, folder.id);
      var count = folderItemCount(folder.id, subFolders, links);
      return '<div class="doc-folder-admin" data-folder-id="' + escHtml(folder.id) + '">'
        + '<div class="doc-folder-admin-header"><span class="folder-glyph">📁</span>'
        + '<input class="f-folder-name" value="' + escHtml(folder.name) + '" aria-label="Folder name">'
        + '<span class="folder-count">' + count + (count === 1 ? ' item' : ' items') + '</span>'
        + '<div class="doc-folder-admin-actions">'
        + '<button class="icon-btn btn-sm" data-add-link-folder="' + escHtml(folder.id) + '" title="Add document or link to this folder">+ Link</button>'
        + '<button class="icon-btn btn-sm" data-add-subfolder="' + escHtml(folder.id) + '" title="Add a folder inside this folder">+ Folder</button>'
        + '<button class="icon-btn" data-save-folder="' + escHtml(folder.id) + '" title="Save folder name">💾</button>'
        + '<button class="icon-btn" data-delete-folder="' + escHtml(folder.id) + '" title="Delete folder">🗑</button>'
        + '</div></div>'
        + '<div class="doc-folder-admin-body">'
        + '<div class="link-rows" data-sub-id="' + escHtml(subId) + '" data-folder-id="' + escHtml(folder.id) + '">' + directLinks.map(linkRowHtml).join('') + '</div>'
        + '<div class="doc-folder-admin-children">' + children.map(function (child) { return adminFolderHtml(child, subId, subFolders, links, depth + 1); }).join('') + '</div>'
        + '</div></div>';
    }

    renderOuDetail = function (ouId) {
      var ou = OUS.find(function (o) { return o.id === ouId; });
      if (!ou) return;
      var subs = SUBS.filter(function (s) { return s.ou_id === ouId; }).sort(function (a, b) { return a.sort_order - b.sort_order; });
      var detail = document.getElementById('ouDetail');
      var migrationNote = adminFolderSchemaAvailable ? '' : '<div class="folder-migration-note"><strong>Folder database migration required.</strong> Run <code>20_document_folders.sql</code> in Supabase before creating folders. Existing content continues to work until then.</div>';
      detail.innerHTML = migrationNote
        + '<div class="editable-card" id="ouEditCard" style="margin-bottom:18px;">'
        + '<div class="fields">'
        + '<div><span class="field-label">Name</span><input class="f-ou-name" value="' + escHtml(ou.name) + '"></div>'
        + '<div><span class="field-label">Badge (short code, e.g. "APAC")</span><input class="f-ou-badge" value="' + escHtml(ou.badge || '') + '" maxlength="6"></div>'
        + '<div><span class="field-label">Color</span><input class="f-ou-color" type="color" value="' + escHtml(ou.color || '#02355A') + '" style="height:38px;padding:2px;"></div>'
        + '<div><span class="field-label">Restricted (shows "Legal only" badge)</span><label style="display:flex;align-items:center;gap:8px;height:38px;"><input class="f-ou-restricted" type="checkbox"' + (ou.restricted ? ' checked' : '') + '> Legal-only content</label></div>'
        + '<div style="grid-column:1/-1"><span class="field-label">Meta / short description (shown under the tile name)</span><input class="f-ou-meta" value="' + escHtml(ou.meta || '') + '"></div>'
        + '<div style="grid-column:1/-1;font-size:11px;color:var(--text-muted);">Slug: <code>' + escHtml(ou.slug) + '</code> — not editable here, since some site behavior is tied to it.</div>'
        + '</div><div class="row-actions"><button class="icon-btn" id="ouSaveBtn" title="Save">💾</button><button class="icon-btn" id="ouDeleteBtn" title="Delete this Operating Unit">🗑</button></div></div>'
        + '<div class="sub-drag-zone" id="subDragZone">'
        + subs.map(function (sub) {
          var links = LINKS.filter(function (l) { return l.subsection_id === sub.id; }).sort(function (a, b) { return a.sort_order - b.sort_order; });
          var subFolders = adminFolders.filter(function (f) { return f.subsection_id === sub.id; });
          var rootLinks = links.filter(function (l) { return !l.folder_id || !subFolders.some(function (f) { return f.id === l.folder_id; }); });
          var roots = folderChildren(subFolders, null);
          return '<div class="sub-block" data-id="' + sub.id + '">'
            + '<div class="sub-block-header"><span class="drag-handle">⠇⠇</span><h3>' + escHtml(sub.name) + '</h3>'
            + '<div style="display:flex;gap:6px;align-items:center;">'
            + '<button class="icon-btn btn-sm" data-add-folder="' + sub.id + '" title="Add folder"' + (adminFolderSchemaAvailable ? '' : ' disabled') + '>+ Add folder</button>'
            + '<button class="icon-btn btn-sm" data-add-link="' + sub.id + '" title="Add link or document">+ Add link</button>'
            + '<button class="icon-btn btn-sm" data-delete-sub="' + sub.id + '" title="Delete this subsection and all its links">🗑</button></div></div>'
            + '<div class="link-rows" data-sub-id="' + sub.id + '" data-folder-id="">' + rootLinks.map(linkRowHtml).join('') + '</div>'
            + '<div class="folder-tree-admin">' + roots.map(function (folder) { return adminFolderHtml(folder, sub.id, subFolders, links, 0); }).join('') + '</div>'
            + '</div>';
        }).join('')
        + '</div><button class="btn btn-ghost btn-sm" id="addSubBtn">+ Add subsection</button>';

      document.getElementById('ouSaveBtn').addEventListener('click', function () { saveOu(ouId); });
      document.getElementById('ouDeleteBtn').addEventListener('click', function () { deleteOu(ouId); });
      detail.querySelectorAll('[data-add-link]').forEach(function (b) { b.addEventListener('click', function () { addLink(b.dataset.addLink, null); }); });
      detail.querySelectorAll('[data-add-folder]').forEach(function (b) { b.addEventListener('click', function () { addDocumentFolder(b.dataset.addFolder, null); }); });
      detail.querySelectorAll('[data-delete-sub]').forEach(function (b) { b.addEventListener('click', function () { deleteSubsection(b.dataset.deleteSub, ouId); }); });
      detail.querySelectorAll('[data-add-link-folder]').forEach(function (b) { b.addEventListener('click', function () { var f = adminFolders.find(function (x) { return x.id === b.dataset.addLinkFolder; }); if (f) addLink(f.subsection_id, f.id); }); });
      detail.querySelectorAll('[data-add-subfolder]').forEach(function (b) { b.addEventListener('click', function () { var f = adminFolders.find(function (x) { return x.id === b.dataset.addSubfolder; }); if (f) addDocumentFolder(f.subsection_id, f.id); }); });
      detail.querySelectorAll('[data-save-folder]').forEach(function (b) { b.addEventListener('click', async function () {
        var box = b.closest('.doc-folder-admin');
        var name = box.querySelector('.f-folder-name').value.trim();
        if (!name) { alert('Folder name can\'t be empty.'); return; }
        var res = await sb.from(FOLDER_TABLE).update({ name: name, updated_at: new Date().toISOString() }).eq('id', b.dataset.saveFolder);
        if (res.error) { alert('Could not save folder: ' + res.error.message); return; }
        await loadContentTab();
      }); });
      detail.querySelectorAll('[data-delete-folder]').forEach(function (b) { b.addEventListener('click', async function () {
        var id = b.dataset.deleteFolder;
        var folder = adminFolders.find(function (x) { return x.id === id; });
        var descendants = descendantFolderIds(id, adminFolders);
        var docCount = LINKS.filter(function (l) { return [id].concat(descendants).indexOf(l.folder_id) !== -1; }).length;
        var childCount = descendants.length;
        var msg = 'Delete folder "' + (folder ? folder.name : 'this folder') + '"?';
        if (childCount || docCount) msg += '\n\nThis also removes ' + childCount + ' nested folder' + (childCount === 1 ? '' : 's') + '. The ' + docCount + ' document/link' + (docCount === 1 ? '' : 's') + ' inside will be moved back to the subsection root.';
        msg += '\n\nThis cannot be undone.';
        if (!confirm(msg)) return;
        var res = await sb.from(FOLDER_TABLE).delete().eq('id', id);
        if (res.error) { alert('Could not delete folder: ' + res.error.message); return; }
        await loadContentTab();
      }); });
      detail.querySelectorAll('.link-row').forEach(wireLinkRow);
      var addSub = document.getElementById('addSubBtn');
      if (addSub) addSub.addEventListener('click', function () { addSubsection(ouId); });
      enableDragReorder(document.getElementById('subDragZone'), '.sub-block', 'subsections', function () { renderOuDetail(ouId); });
      detail.querySelectorAll('.link-rows').forEach(function (zone) { enableDragReorder(zone, '.link-row', 'links', null); });
    };

    linkRowHtml = function (l) {
      var hasFile = !!l.file_url;
      return '<div class="link-row folder-enabled" data-id="' + l.id + '" data-link-id="' + l.id + '">'
        + '<span class="drag-handle">⠇⠇</span>'
        + '<input class="f-label" value="' + escHtml(l.label) + '" placeholder="Label">'
        + '<input class="f-url" value="' + escHtml(l.url || '') + '" placeholder="URL (or upload a PDF instead →)">'
        + '<select class="f-folder"' + (adminFolderSchemaAvailable ? '' : ' disabled') + '>' + folderOptionsHtml(l.subsection_id, l.folder_id) + '</select>'
        + '<select class="f-status"><option value="live"' + (l.status === 'live' ? ' selected' : '') + '>Live</option><option value="pending"' + (l.status === 'pending' ? ' selected' : '') + '>Pending</option></select>'
        + '<input class="f-note" value="' + escHtml(l.pending_note || '') + '" placeholder="Pending note">'
        + '<div class="file-actions">'
        + (hasFile
          ? '<a href="' + escHtml(l.file_url) + '" target="_blank" rel="noopener" class="icon-btn" title="Preview uploaded PDF">👁</a>'
            + '<a href="' + escHtml(downloadUrl(l.file_url, l.label)) + '" download class="icon-btn" title="Download uploaded PDF">⬇</a>'
            + '<button class="icon-btn" data-remove-file title="Remove uploaded file, use URL instead">📄✕</button>'
          : '<label class="icon-btn" title="Upload a PDF — used instead of the URL above when set"><input type="file" class="f-upload-doc" accept="application/pdf" style="display:none;">📎</label>')
        + '<button class="icon-btn" data-save title="Save">💾</button><button class="icon-btn" data-delete title="Delete">🗑</button></div>'
        + '<div class="upload-status" style="grid-column:1/-1;font-size:11px;color:var(--text-muted);"></div></div>';
    };

    wireLinkRow = function (row) {
      var id = row.dataset.linkId;
      row.querySelector('[data-save]').addEventListener('click', async function () {
        var url = row.querySelector('.f-url').value.trim() || null;
        var destinationId = await resolveDestinationId(url);
        var payload = {
          label: row.querySelector('.f-label').value.trim(),
          url: url,
          destination_id: destinationId,
          status: row.querySelector('.f-status').value,
          pending_note: row.querySelector('.f-note').value.trim() || null,
          updated_at: new Date().toISOString()
        };
        if (adminFolderSchemaAvailable) payload.folder_id = row.querySelector('.f-folder').value || null;
        var res = await sb.from('links').update(payload).eq('id', id);
        if (res.error) { flashRow(row, 'Error'); alert('Save failed: ' + res.error.message); return; }
        await loadContentTab();
      });
      row.querySelector('[data-delete]').addEventListener('click', async function () {
        if (!confirm('Delete this link or document?')) return;
        await sb.from('links').delete().eq('id', id);
        await loadContentTab();
      });
      var uploadInput = row.querySelector('.f-upload-doc');
      if (uploadInput) uploadInput.addEventListener('change', async function () {
        var file = uploadInput.files[0];
        if (!file) return;
        var statusEl = row.querySelector('.upload-status');
        statusEl.textContent = 'Uploading…';
        var path = id + '/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        var up = await sb.storage.from('link-documents').upload(path, file);
        if (up.error) { statusEl.textContent = 'Upload failed: ' + up.error.message; return; }
        var urlData = sb.storage.from('link-documents').getPublicUrl(path).data;
        var saved = await sb.from('links').update({ file_url: urlData.publicUrl }).eq('id', id);
        if (saved.error) { statusEl.textContent = 'Saved file but failed to link it: ' + saved.error.message; return; }
        await loadContentTab();
      });
      var removeFileBtn = row.querySelector('[data-remove-file]');
      if (removeFileBtn) removeFileBtn.addEventListener('click', async function () {
        if (!confirm('Remove the uploaded file from this link? The URL field will be used instead, if set.')) return;
        await sb.from('links').update({ file_url: null }).eq('id', id);
        await loadContentTab();
      });
    };

    addLink = async function (subsectionId, folderId) {
      var existing = LINKS.filter(function (l) { return l.subsection_id === subsectionId && (l.folder_id || null) === (folderId || null); });
      var payload = { subsection_id: subsectionId, label: 'New link', status: 'pending', pending_note: 'Pending', sort_order: existing.length, icon: 'i-link' };
      if (adminFolderSchemaAvailable && folderId) payload.folder_id = folderId;
      var res = await sb.from('links').insert(payload);
      if (res.error) { alert('Could not add link: ' + res.error.message); return; }
      await loadContentTab();
    };

    window.addDocumentFolder = async function (subsectionId, parentFolderId) {
      if (!adminFolderSchemaAvailable) { alert('Run 20_document_folders.sql in Supabase first, then refresh this page.'); return; }
      var name = prompt(parentFolderId ? 'Subfolder name:' : 'Folder name:');
      if (!name || !name.trim()) return;
      var siblings = adminFolders.filter(function (f) { return f.subsection_id === subsectionId && (f.parent_folder_id || null) === (parentFolderId || null); });
      var res = await sb.from(FOLDER_TABLE).insert({ subsection_id: subsectionId, parent_folder_id: parentFolderId || null, name: name.trim(), sort_order: siblings.length });
      if (res.error) { alert('Could not create folder: ' + res.error.message); return; }
      await loadContentTab();
    };

    setTimeout(loadContentTab, 0);
    return true;
  }

  function tryInstall() {
    try {
      var onAdmin = /\/admin\/?(?:$|[?#])/.test(window.location.pathname + window.location.search + window.location.hash) || window.location.pathname.indexOf('/admin/') === 0;
      if (onAdmin) installAdmin();
      else installFront();
    } catch (error) {
      console.warn('Document folder feature initialisation failed:', error);
    }
  }

  tryInstall();
  var attempts = 0;
  var timer = setInterval(function () {
    attempts += 1;
    tryInstall();
    if ((adminInstalled || frontInstalled) || attempts > 100) clearInterval(timer);
  }, 50);
})();
