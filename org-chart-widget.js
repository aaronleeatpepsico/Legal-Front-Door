/* ---------------------------------------------------------------------------
   Org Chart widget — mounts into the Front Door's existing "Our Team"
   modal (#omo / #omm / .omb). Framework-free, matches the site's existing
   stack (plain JS + the page's own Supabase client).

   Admin gating matches the site's real pattern (see index.html):
     - session = await sb.auth.getSession()
     - isAdmin = a row exists in `admins` for that email
   There is no separate sign-in UI here — people already sign in via the
   site's nav ("Admin / Sign in" -> /admin/, Microsoft OAuth). This widget
   just reads that same session/admins state. If you're signed in as an
   admin elsewhere on the site and open "Our Team", editing unlocks
   automatically; nothing to configure per-page.

   REQUIRES (once, per Supabase project — you already have `admins`):

   1. Table:
      create table org_chart_people (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        role text,
        email text,
        description text,
        photo_url text,
        manager_id uuid references org_chart_people(id) on delete set null,
        created_at timestamptz default now(),
        updated_at timestamptz default now()
      );

   2. RLS — public read, write restricted to rows in `admins`:
      alter table org_chart_people enable row level security;
      create policy "public read" on org_chart_people for select using (true);
      create policy "admins write" on org_chart_people
        for all using (
          exists (select 1 from admins a where a.email ilike auth.jwt()->>'email')
        )
        with check (
          exists (select 1 from admins a where a.email ilike auth.jwt()->>'email')
        );

   3. Storage bucket "org-photos" (public read; upload restricted the same
      way via a storage policy checking `admins`).

   USAGE (already wired into index.html):
     <link rel="stylesheet" href="/org-chart.css">
     <script src="/org-chart-widget.js"></script>
     <script>
       // lazily, e.g. the first time the modal opens:
       const ctrl = OrgChart.mountPage(document.getElementById('teamChartMount'));
       // ctrl.refresh() on subsequent opens to pick up admin/session changes
     </script>
--------------------------------------------------------------------------- */
(function () {
  "use strict";

  // NOTE: intentionally NOT `window.sb` — the page defines its client as
  // `const sb = window.supabase.createClient(...)` inside a classic
  // <script> tag. Top-level const/let in a classic script does not
  // attach to `window`, but it IS visible by bare name to other classic
  // scripts loaded afterward in the same document (they share the
  // script-global lexical scope) — which is how this file, loaded via
  // <script src>, can see `sb` here without ever assigning to it.
  if (typeof sb === 'undefined') {
    console.error('OrgChart: expected the page\'s `sb` Supabase client to already be declared before this script runs.');
    return;
  }

  const TABLE = 'org_chart_people';
  const BUCKET = 'org-photos';

  // --- layout geometry -------------------------------------------------
  const NODE_W = 178, NODE_H = 68, H_GAP = 22, V_GAP = 54, SIDE_PAD = 32, TOP_PAD = 32, BOTTOM_PAD = 40;

  function escHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function initials(name) {
    return (name || '').trim().split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase();
  }

  function resizeImage(file, maxDim) {
    maxDim = maxDim || 240;
    return new Promise(function (resolve, reject) {
      if (!file || !file.type.startsWith('image/')) { reject(new Error('Please choose an image file')); return; }
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read that file')); };
      reader.onload = function () {
        const img = new Image();
        img.onerror = function () { reject(new Error('Could not load that image')); };
        img.onload = function () {
          let w = img.width, h = img.height;
          if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
          else if (h >= w && h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) { resolve(blob); }, 'image/jpeg', 0.85);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // --- tree layout: bottom-up subtree widths, top-down positions -------
  function layoutTree(rows) {
    const byId = {};
    rows.forEach(function (r) { byId[r.id] = Object.assign({}, r, { children: [] }); });
    const roots = [];
    rows.forEach(function (r) {
      if (r.manager_id && byId[r.manager_id]) byId[r.manager_id].children.push(byId[r.id]);
      else roots.push(byId[r.id]); // top-level people and records whose manager was removed
    });
    if (!roots.length) return { byId: byId, positions: {}, edges: [], width: 0, height: 0 };

    let maxDepth = 0;
    function measure(node, depth) {
      maxDepth = Math.max(maxDepth, depth);
      if (!node.children.length) { node._w = NODE_W; return node._w; }
      let w = 0;
      node.children.forEach(function (c, i) { if (i > 0) w += H_GAP; w += measure(c, depth + 1); });
      node._w = Math.max(NODE_W, w);
      return node._w;
    }
    roots.forEach(function (root) { measure(root, 0); });

    function place(node, leftEdge, depth) {
      const y = TOP_PAD + depth * (NODE_H + V_GAP);
      if (!node.children.length) { node.x = leftEdge + node._w / 2; node.y = y; return; }
      const childrenWidth = node.children.reduce(function (s, c, i) { return s + c._w + (i > 0 ? H_GAP : 0); }, 0);
      let cursor = leftEdge + (node._w - childrenWidth) / 2;
      node.children.forEach(function (c) { place(c, cursor, depth + 1); cursor += c._w + H_GAP; });
      node.x = (node.children[0].x + node.children[node.children.length - 1].x) / 2;
      node.y = y;
    }
    let rootCursor = SIDE_PAD;
    roots.forEach(function (root) {
      place(root, rootCursor, 0);
      rootCursor += root._w + H_GAP;
    });

    const positions = {}, edges = [];
    function collect(node) {
      positions[node.id] = { x: node.x, y: node.y };
      if (node.children.length) {
        edges.push({
          parentId: node.id,
          parent: { x: node.x, y: node.y },
          children: node.children.map(function (c) { return { id: c.id, x: c.x, y: c.y }; })
        });
      }
      node.children.forEach(collect);
    }
    roots.forEach(collect);

    const forestWidth = roots.reduce(function (sum, root, i) {
      return sum + root._w + (i > 0 ? H_GAP : 0);
    }, 0);
    return {
      byId: byId, positions: positions, edges: edges,
      width: forestWidth + SIDE_PAD * 2,
      height: TOP_PAD + maxDepth * (NODE_H + V_GAP) + NODE_H + BOTTOM_PAD
    };
  }

  function getDescendantIds(rows, id) {
    const out = new Set();
    (function walk(pid) {
      rows.forEach(function (r) { if (r.manager_id === pid && !out.has(r.id)) { out.add(r.id); walk(r.id); } });
    })(id);
    return out;
  }

  // --- controller: one per mounted instance -----------------------------
  function createController(containerEl) {
    let rows = [];
    let isAdmin = false;
    let selectedId = null;
    let dragId = null;
    let dropTargetId = null;
    let toastTimer = null;

    containerEl.innerHTML =
      '<div class="oc-wrap">' +
        '<div class="oc-canvas-scroll"><div class="oc-canvas" data-oc="canvas"></div></div>' +
        '<div class="oc-legend" data-oc="legend"></div>' +
        '<div data-oc="modals"></div>' +
        '<div data-oc="toast"></div>' +
      '</div>';

    const els = {
      canvas: containerEl.querySelector('[data-oc="canvas"]'),
      legend: containerEl.querySelector('[data-oc="legend"]'),
      modals: containerEl.querySelector('[data-oc="modals"]'),
      toast: containerEl.querySelector('[data-oc="toast"]')
    };

    function showToast(msg) {
      els.toast.innerHTML = '<div style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
        'background:var(--pep-navy);color:#fff;padding:10px 18px;border-radius:100px;font-size:12px;' +
        'font-weight:500;box-shadow:0 10px 30px rgba(2,53,90,.35);z-index:1000;font-family:var(--font-body);">' +
        escHtml(msg) + '</div>';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { els.toast.innerHTML = ''; }, 2200);
    }

    function nodesById() {
      const m = {};
      rows.forEach(function (r) { m[r.id] = r; });
      return m;
    }

    // Mirrors the exact check the rest of index.html uses (see
    // updateAuthNav / the homepage init flow): a session plus a matching
    // row in `admins`. No separate sign-in here — admins already sign in
    // via the site's own nav.
    async function refreshAuth() {
      const { data } = await sb.auth.getSession();
      const session = data && data.session;
      isAdmin = false;
      if (session) {
        const { data: adminRow } = await sb.from('admins').select('email').ilike('email', session.user.email).maybeSingle();
        isAdmin = !!adminRow;
      }
      els.legend.textContent = isAdmin
        ? 'Signed in as admin. Click a person to edit, add a report, or remove them. Drag a card onto another to reassign.'
        : '';
    }

    async function loadData() {
      const { data, error } = await sb.from(TABLE).select('*').order('created_at');
      if (error) {
        els.canvas.innerHTML = '<div class="oc-empty-hint">Couldn\u2019t load the org chart right now. Try refreshing.</div>';
        console.error(error);
        return;
      }
      rows = data || [];
      render();
    }

    function render() {
      if (!rows.length) { els.canvas.innerHTML = '<div class="oc-empty-hint">No one on the chart yet.</div>'; return; }
      const layout = layoutTree(rows);
      const byId = nodesById();
      const width = Math.max(layout.width, 600), height = layout.height;
      els.canvas.style.width = width + 'px';
      els.canvas.style.height = height + 'px';

      let svg = '<svg width="' + width + '" height="' + height + '">';
      layout.edges.forEach(function (edge) {
        const busY = edge.parent.y + NODE_H / 2 + V_GAP / 2;
        const xs = edge.children.map(function (c) { return c.x; }).concat([edge.parent.x]);
        const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
        const active = dragId && edge.children.some(function (c) { return c.id === dragId; });
        const stroke = active ? 'var(--pep-blue)' : '#c7d3de';
        const sw = active ? 2 : 1.4;
        svg += '<line x1="' + edge.parent.x + '" y1="' + (edge.parent.y + NODE_H / 2) + '" x2="' + edge.parent.x + '" y2="' + busY + '" stroke="' + stroke + '" stroke-width="' + sw + '"/>';
        if (edge.children.length > 1) {
          svg += '<line x1="' + minX + '" y1="' + busY + '" x2="' + maxX + '" y2="' + busY + '" stroke="' + stroke + '" stroke-width="' + sw + '"/>';
        }
        edge.children.forEach(function (c) {
          const cs = c.id === dragId ? 'var(--pep-blue)' : '#c7d3de';
          const csw = c.id === dragId ? 2 : 1.4;
          svg += '<line x1="' + c.x + '" y1="' + busY + '" x2="' + c.x + '" y2="' + (c.y - NODE_H / 2) + '" stroke="' + cs + '" stroke-width="' + csw + '"/>';
        });
      });
      svg += '</svg>';

      let cards = '';
      rows.forEach(function (n) {
        const pos = layout.positions[n.id];
        if (!pos) return;
        const isRoot = !n.manager_id;
        const isSelected = selectedId === n.id;
        const isDropTarget = dropTargetId === n.id;
        const isDragging = dragId === n.id;
        const classes = ['oc-card'];
        if (isSelected) classes.push('oc-selected');
        if (isDropTarget) classes.push('oc-drop-target');
        if (isDragging) classes.push('oc-dragging');
        if (isAdmin && !isRoot) classes.push('oc-admin');

        const avatar = n.photo_url
          ? '<img class="oc-avatar" src="' + escHtml(n.photo_url) + '" alt="">'
          : '<div class="oc-avatar">' + escHtml(initials(n.name)) + '</div>';

        let expand = '';
        if (isSelected) {
          let pills = '';
          if (n.email) {
            pills += '<a class="oc-icon-btn" href="mailto:' + escHtml(n.email) + '" title="Email" data-oc-stop="1">\u2709</a>';
            pills += '<a class="oc-icon-btn" href="https://teams.microsoft.com/l/chat/0/0?users=' + escHtml(n.email) + '" target="_blank" rel="noopener" title="Teams" data-oc-stop="1">\uD83D\uDCAC</a>';
          }
          if (isAdmin) {
            pills += '<button class="oc-icon-btn" data-oc-edit="' + n.id + '" title="Edit">\u270E</button>';
            pills += '<button class="oc-icon-btn" data-oc-add="' + n.id + '" title="Add report">+</button>';
            if (!isRoot) pills += '<button class="oc-icon-btn oc-danger" data-oc-del="' + n.id + '" title="Remove">\u2716</button>';
          }
          expand = '<div class="oc-card-expand">' +
            (n.description ? '<div class="oc-desc">' + escHtml(n.description) + '</div>' : '') +
            '<div class="oc-actions">' + pills + '</div>' +
          '</div>';
        }

        cards += '<div class="' + classes.join(' ') + '" style="left:' + pos.x + 'px;top:' + pos.y + 'px;" ' +
          'data-oc-card="' + n.id + '" ' + ((isAdmin && !isRoot) ? 'draggable="true"' : '') + '>' +
          (isAdmin && !isRoot ? '<span class="oc-grip">\u22EE\u22EE</span>' : '') +
          '<div class="oc-card-top">' + avatar +
            '<div style="min-width:0;padding-right:10px;">' +
              '<div class="oc-name" title="' + escHtml(n.name) + '">' + escHtml(n.name) + '</div>' +
              '<div class="oc-role" title="' + escHtml(n.role || '') + '">' + escHtml(n.role || '') + '</div>' +
            '</div>' +
          '</div>' + expand +
        '</div>';
      });

      els.canvas.innerHTML = svg + cards;
      wireCardEvents(byId);
    }

    function wireCardEvents(byId) {
      els.canvas.querySelectorAll('[data-oc-card]').forEach(function (card) {
        const id = card.getAttribute('data-oc-card');

        card.addEventListener('click', function (e) {
          if (e.target.closest('[data-oc-stop]') || e.target.closest('[data-oc-edit],[data-oc-add],[data-oc-del]')) return;
          selectedId = (selectedId === id) ? null : id;
          render();
        });

        card.addEventListener('dragstart', function (e) { e.stopPropagation(); dragId = id; });
        card.addEventListener('dragover', function (e) {
          if (!isAdmin || !dragId) return;
          e.preventDefault();
          if (canDrop(id)) { dropTargetId = id; card.classList.add('oc-drop-target'); }
        });
        card.addEventListener('dragleave', function () { if (dropTargetId === id) { dropTargetId = null; card.classList.remove('oc-drop-target'); } });
        card.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); handleDrop(id); });
        card.addEventListener('dragend', function () { dragId = null; dropTargetId = null; render(); });

        const editBtn = card.querySelector('[data-oc-edit]');
        if (editBtn) editBtn.onclick = function (e) { e.stopPropagation(); openPersonModal('edit', byId[id]); };
        const addBtn = card.querySelector('[data-oc-add]');
        if (addBtn) addBtn.onclick = function (e) { e.stopPropagation(); openPersonModal('add', { manager_id: id }); };
        const delBtn = card.querySelector('[data-oc-del]');
        if (delBtn) delBtn.onclick = function (e) { e.stopPropagation(); deletePerson(byId[id]); };
      });
    }

    function canDrop(targetId) {
      if (!dragId || !targetId) return false;
      if (targetId === dragId) return false;
      const byId = nodesById();
      if (targetId === (byId[dragId] || {}).manager_id) return false;
      return !getDescendantIds(rows, dragId).has(targetId);
    }

    async function handleDrop(targetId) {
      if (canDrop(targetId)) {
        const byId = nodesById();
        const name = (byId[dragId] || {}).name;
        const targetName = (byId[targetId] || {}).name;
        const { error } = await sb.from(TABLE).update({ manager_id: targetId, updated_at: new Date().toISOString() }).eq('id', dragId);
        dragId = null; dropTargetId = null;
        if (error) { showToast('Could not reassign: ' + error.message); render(); return; }
        showToast(name + ' now reports to ' + targetName);
        await loadData();
      } else {
        dragId = null; dropTargetId = null; render();
      }
    }

    async function deletePerson(node) {
      if (!node) return;
      if (!node.manager_id) { showToast("Can't delete the top of the chart"); return; }
      if (!confirm('Remove ' + node.name + '? Their reports will move up to their manager.')) return;
      const { error: moveErr } = await sb.from(TABLE).update({ manager_id: node.manager_id }).eq('manager_id', node.id);
      if (moveErr) { showToast('Could not remove: ' + moveErr.message); return; }
      const { error: delErr } = await sb.from(TABLE).delete().eq('id', node.id);
      if (delErr) { showToast('Could not remove: ' + delErr.message); return; }
      selectedId = null;
      showToast('Removed ' + node.name);
      await loadData();
    }

    function openPersonModal(mode, seed) {
      const isEdit = mode === 'edit';
      const data = isEdit
        ? { id: seed.id, name: seed.name || '', role: seed.role || '', email: seed.email || '', description: seed.description || '', photo_url: seed.photo_url || null }
        : { manager_id: seed.manager_id, name: '', role: '', email: '', description: '', photo_url: null };
      let pendingPhotoFile = null;

      els.modals.innerHTML =
        '<div class="oc-modal-overlay oc-open" data-oc-close="overlay">' +
          '<form class="oc-modal-panel" data-oc-form="person">' +
            '<div class="oc-modal-title">' + (isEdit ? 'Edit ' + escHtml(data.name) : 'Add report') + '</div>' +
            '<div class="oc-modal-sub">' + (isEdit ? 'Update their details, headshot, or description.' : 'New person will be added below their manager on the chart.') + '</div>' +
            '<label class="oc-field-label">Headshot</label>' +
            '<div class="oc-photo-row">' +
              (data.photo_url
                ? '<img class="oc-avatar" style="width:52px;height:52px;font-size:16px;" src="' + escHtml(data.photo_url) + '" alt="">'
                : '<div class="oc-avatar" style="width:52px;height:52px;font-size:16px;">' + escHtml(initials(data.name)) + '</div>') +
              '<div style="display:flex;flex-direction:column;gap:6px;">' +
                '<label class="oc-file-btn">\uD83D\uDCF7 ' + (data.photo_url ? 'Replace photo' : 'Upload photo') + '<input type="file" accept="image/*" data-oc="photoInput" style="display:none;"></label>' +
                (data.photo_url ? '<button type="button" class="oc-btn oc-btn-sm" data-oc="removePhoto">Remove photo</button>' : '') +
              '</div>' +
            '</div>' +
            '<div class="oc-error" data-oc="photoError"></div>' +
            '<label class="oc-field-label">Name</label>' +
            '<input class="oc-input" name="name" value="' + escHtml(data.name) + '" placeholder="Full name" required>' +
            '<label class="oc-field-label">Role</label>' +
            '<input class="oc-input" name="role" value="' + escHtml(data.role) + '" placeholder="Job title">' +
            '<label class="oc-field-label">Email</label>' +
            '<input class="oc-input" name="email" type="email" value="' + escHtml(data.email) + '" placeholder="name@pepsico.com">' +
            '<label class="oc-field-label">Description</label>' +
            '<textarea class="oc-textarea" name="description" placeholder="Department, responsibilities, or team notes">' + escHtml(data.description) + '</textarea>' +
            '<div class="oc-modal-actions">' +
              '<button type="button" class="oc-btn" data-oc-close="cancel">Cancel</button>' +
              '<button type="submit" class="oc-btn oc-btn-solid">' + (isEdit ? 'Save changes' : 'Add person') + '</button>' +
            '</div>' +
          '</form>' +
        '</div>';

      function closeModal() { els.modals.innerHTML = ''; }
      els.modals.querySelectorAll('[data-oc-close]').forEach(function (el) {
        el.onclick = function (e) {
          if (e.target !== el && el.getAttribute('data-oc-close') === 'overlay') return;
          closeModal();
        };
      });

      const form = els.modals.querySelector('[data-oc-form="person"]');
      const photoInput = form.querySelector('[data-oc="photoInput"]');
      const removeBtn = form.querySelector('[data-oc="removePhoto"]');
      photoInput.onchange = async function () {
        const file = photoInput.files[0];
        photoInput.value = '';
        if (!file) return;
        try {
          pendingPhotoFile = await resizeImage(file);
          data.photo_url = 'pending';
          form.querySelector('[data-oc="photoError"]').textContent = '';
        } catch (err) {
          form.querySelector('[data-oc="photoError"]').textContent = err.message;
        }
      };
      if (removeBtn) removeBtn.onclick = function () { data.photo_url = null; pendingPhotoFile = 'REMOVE'; };

      form.onsubmit = async function (e) {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        const payload = {
          name: form.name.value.trim(),
          role: form.role.value.trim() || 'Team Member',
          email: form.email.value.trim(),
          description: form.description.value.trim(),
          updated_at: new Date().toISOString()
        };
        if (!isEdit) payload.manager_id = data.manager_id;

        try {
          if (pendingPhotoFile === 'REMOVE') {
            payload.photo_url = null;
          } else if (pendingPhotoFile) {
            const path = (isEdit ? data.id : 'new_' + Date.now()) + '_' + Date.now() + '.jpg';
            const { error: upErr } = await sb.storage.from(BUCKET).upload(path, pendingPhotoFile, { upsert: true, contentType: 'image/jpeg' });
            if (upErr) throw upErr;
            const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
            payload.photo_url = pub.publicUrl;
          }

          if (isEdit) {
            const { error } = await sb.from(TABLE).update(payload).eq('id', data.id);
            if (error) throw error;
            showToast('Updated ' + payload.name);
          } else {
            const { error } = await sb.from(TABLE).insert(payload);
            if (error) throw error;
            showToast('Added ' + payload.name);
          }
          closeModal();
          await loadData();
        } catch (err) {
          form.querySelector('[data-oc="photoError"]').textContent = err.message || 'Something went wrong saving this.';
          submitBtn.disabled = false;
        }
      };
    }

    sb.auth.onAuthStateChange(function () { refreshAuth().then(render); });

    return {
      init: async function () { await refreshAuth(); await loadData(); },
      refresh: async function () { await refreshAuth(); await loadData(); }
    };
  }

  window.OrgChart = {
    mountPage: function (containerEl) {
      const c = createController(containerEl);
      c.init();
      return c;
    }
  };
})();
