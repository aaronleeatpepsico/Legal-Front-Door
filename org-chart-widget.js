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
  const NODE_W = 148, NODE_H = 52, H_GAP = 16, V_GAP = 14, SIDE_PAD = 24, TOP_PAD = 24, BOTTOM_PAD = 24;

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

  // --- compact executive-chart layout ----------------------------------
  // Packs each top-level leader's organisation into one or more vertical
  // lanes. This mirrors a conventional corporate org chart and avoids a
  // leaf-per-column canvas that becomes several screens wide.
  function layoutTree(rows) {
    const byId = {};
    rows.forEach(function (r) { byId[r.id] = Object.assign({}, r, { children: [] }); });
    const roots = [];
    rows.forEach(function (r) {
      if (r.manager_id && byId[r.manager_id]) byId[r.manager_id].children.push(byId[r.id]);
      else roots.push(byId[r.id]);
    });
    if (!roots.length) return { byId: byId, positions: {}, edges: [], width: 0, height: 0 };

    const positions = {}, edges = [];
    const GROUP_GAP = 24;
    const LANE_GAP = 12;
    const ROW_STEP = NODE_H + V_GAP;
    const MAX_LANE_ROWS = 6;
    const ROOT_Y = TOP_PAD + NODE_H / 2;
    const BRANCH_Y = ROOT_Y + 140;

    function flatten(node, out) {
      out.push(node);
      node.children.forEach(function (child) { flatten(child, out); });
      return out;
    }

    // Use the top-level person with the largest direct organisation as the
    // executive anchor. Other top-level people (including dotted-line reports
    // without a direct manager) remain aligned on the leadership tier.
    const executive = roots.slice().sort(function (a, b) {
      return b.children.length - a.children.length;
    })[0] || null;
    const topChildren = executive
      ? executive.children.slice().concat(roots.filter(function (r) { return r.id !== executive.id; }))
      : roots.slice();
    const assistants = executive
      ? topChildren.filter(function (n) { return /executive assistant/i.test(n.role || ''); })
      : [];
    const branches = topChildren.filter(function (n) { return assistants.indexOf(n) === -1; });

    const groups = branches.map(function (branch) {
      const directSubtrees = branch.children.map(function (child) { return flatten(child, []); });
      const descendantCount = directSubtrees.reduce(function (sum, list) { return sum + list.length; }, 0);
      const laneCount = Math.max(1, Math.ceil(descendantCount / MAX_LANE_ROWS));
      const lanes = Array.from({ length: laneCount }, function () { return []; });
      // Preserve the explicit report order for single-column teams. Larger
      // teams use size-aware lane balancing, but never cross leadership groups.
      if (laneCount > 1) {
        directSubtrees.sort(function (a, b) { return b.length - a.length; });
      }
      directSubtrees.forEach(function (subtree) {
        let laneIndex = 0;
        for (let i = 1; i < lanes.length; i++) {
          if (lanes[i].length < lanes[laneIndex].length) laneIndex = i;
        }
        Array.prototype.push.apply(lanes[laneIndex], subtree);
      });
      return {
        branch: branch,
        lanes: lanes,
        width: laneCount * NODE_W + (laneCount - 1) * LANE_GAP
      };
    });

    const groupsWidth = groups.reduce(function (sum, group, i) {
      return sum + group.width + (i > 0 ? GROUP_GAP : 0);
    }, 0);
    const width = Math.max(600, groupsWidth + SIDE_PAD * 2);
    let cursor = (width - groupsWidth) / 2;
    let maxY = BRANCH_Y;

    groups.forEach(function (group) {
      const centerX = cursor + group.width / 2;
      positions[group.branch.id] = { x: centerX, y: BRANCH_Y };
      group.lanes.forEach(function (lane, laneIndex) {
        const laneX = cursor + laneIndex * (NODE_W + LANE_GAP) + NODE_W / 2;
        lane.forEach(function (node, rowIndex) {
          const y = BRANCH_Y + (rowIndex + 1) * ROW_STEP;
          positions[node.id] = { x: laneX, y: y };
          maxY = Math.max(maxY, y);
        });
      });
      cursor += group.width + GROUP_GAP;
    });

    if (executive) {
      positions[executive.id] = { x: width / 2, y: ROOT_Y };
      assistants.forEach(function (assistant, i) {
        const offset = (i - (assistants.length - 1) / 2) * (NODE_W + LANE_GAP);
        positions[assistant.id] = { x: width / 2 + offset, y: ROOT_Y + 72 };
        maxY = Math.max(maxY, ROOT_Y + 72);
      });
    }

    rows.forEach(function (row) {
      const parent = byId[row.id];
      const parentPos = positions[row.id];
      if (!parent || !parentPos) return;
      const visibleChildren = parent.children.filter(function (child) { return !!positions[child.id]; });
      if (visibleChildren.length) {
        edges.push({
          parentId: parent.id,
          parent: parentPos,
          children: visibleChildren.map(function (child) {
            return { id: child.id, x: positions[child.id].x, y: positions[child.id].y };
          })
        });
      }
    });

    const dottedByManager = {};
    rows.forEach(function (row) {
      if (!row.dotted_manager_id || !positions[row.id] || !positions[row.dotted_manager_id]) return;
      (dottedByManager[row.dotted_manager_id] = dottedByManager[row.dotted_manager_id] || []).push(row);
    });
    const dottedEdges = Object.keys(dottedByManager).map(function (managerId) {
      return {
        parentId: managerId,
        parent: positions[managerId],
        children: dottedByManager[managerId].map(function (child) {
          return { id: child.id, x: positions[child.id].x, y: positions[child.id].y };
        })
      };
    });

    return {
      byId: byId,
      positions: positions,
      edges: edges,
      dottedEdges: dottedEdges,
      width: width,
      height: maxY + NODE_H / 2 + BOTTOM_PAD
    };
  }

  function relationshipEdges(rows, positions, field) {
    const grouped = {};
    rows.forEach(function (row) {
      const managerId = row[field];
      if (!managerId || !positions[row.id] || !positions[managerId]) return;
      (grouped[managerId] = grouped[managerId] || []).push(row);
    });
    return Object.keys(grouped).map(function (managerId) {
      return {
        parentId: managerId,
        parent: positions[managerId],
        children: grouped[managerId].map(function (child) {
          return { id: child.id, x: positions[child.id].x, y: positions[child.id].y };
        })
      };
    });
  }

  function getDescendantIds(rows, id) {
    const out = new Set();
    (function walk(pid) {
      rows.forEach(function (r) { if (r.manager_id === pid && !out.has(r.id)) { out.add(r.id); walk(r.id); } });
    })(id);
    return out;
  }

  // --- controller: one per mounted instance -----------------------------
  function createController(containerEl, options) {
    options = options || {};
    const editingAllowed = options.editable !== false;
    let rows = [];
    let isAdmin = false;
    let selectedId = null;
    const selectedIds = new Set();
    let lastSelectionId = null;
    let dragId = null;
    let toastTimer = null;
    let connectMode = null;
    let connectFromId = null;
    let suppressClickId = null;

    containerEl.innerHTML =
      '<div class="oc-wrap">' +
        '<div class="oc-toolbar" data-oc="toolbar" hidden></div>' +
        '<div class="oc-canvas-scroll"><div class="oc-canvas" data-oc="canvas"></div></div>' +
        '<div class="oc-legend" data-oc="legend"></div>' +
        '<div data-oc="modals"></div>' +
        '<div data-oc="toast"></div>' +
      '</div>';

    const els = {
      toolbar: containerEl.querySelector('[data-oc="toolbar"]'),
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
        isAdmin = editingAllowed && !!adminRow;
      }
      els.legend.textContent = (isAdmin
        ? 'Drag cards anywhere. Moving a card never changes its manager. Use the line tools to change reporting relationships. '
        : '') + 'Solid lines show direct management; dotted lines show matrix management.';
      renderToolbar();
    }

    function renderToolbar() {
      if (!isAdmin) {
        els.toolbar.hidden = true;
        els.toolbar.innerHTML = '';
        return;
      }
      els.toolbar.hidden = false;
      const active = connectMode;
      const selectedCount = selectedIds.size;
      const prompt = selectedCount
        ? selectedCount + ' selected — drag any selected card to move the group'
        : (connectFromId ? 'Now choose the report' : (active ? 'Choose the manager' : 'Arrange the chart'));
      els.toolbar.innerHTML =
        '<div class="oc-toolbar-group">' +
          '<button class="oc-tool oc-tool-primary" data-tool="add">+ Add card</button>' +
          '<button class="oc-tool' + (active === 'manager_id' ? ' oc-tool-active' : '') + '" data-tool="manager_id"><span class="oc-line-swatch"></span> Solid line</button>' +
          '<button class="oc-tool' + (active === 'dotted_manager_id' ? ' oc-tool-active' : '') + '" data-tool="dotted_manager_id"><span class="oc-line-swatch oc-line-dotted"></span> Dotted line</button>' +
          '<button class="oc-tool' + (active === 'remove' ? ' oc-tool-active oc-tool-remove' : ' oc-tool-remove') + '" data-tool="remove">Remove line</button>' +
          '<button class="oc-tool" data-tool="arrange">Auto arrange</button>' +
          (selectedCount ? '<button class="oc-tool oc-tool-danger" data-tool="delete-selected">Delete selected (' + selectedCount + ')</button>' +
            '<button class="oc-tool" data-tool="clear-selected">Clear selection</button>' : '') +
          (active ? '<button class="oc-tool oc-tool-cancel" data-tool="cancel">Cancel</button>' : '') +
        '</div>' +
        '<div class="oc-tool-status">' + escHtml(prompt) + '</div>';

      els.toolbar.querySelectorAll('[data-tool]').forEach(function (button) {
        button.onclick = function () {
          const tool = button.getAttribute('data-tool');
          if (tool === 'add') return openPersonModal('add', { manager_id: null });
          if (tool === 'arrange') return autoArrange();
          if (tool === 'delete-selected') return deleteSelectedPeople();
          if (tool === 'clear-selected') { selectedIds.clear(); lastSelectionId = null; render(); return; }
          if (tool === 'cancel') {
            connectMode = null; connectFromId = null; renderToolbar(); render(); return;
          }
          connectMode = tool;
          connectFromId = null;
          selectedId = null;
          selectedIds.clear();
          lastSelectionId = null;
          renderToolbar();
          render();
          showToast('Choose the manager card');
        };
      });
    }

    async function loadData() {
      const { data, error } = await sb.from(TABLE).select('*').order('sort_order').order('created_at');
      if (error) {
        const setupMissing = error.code === '42P01' || error.code === 'PGRST205';
        els.canvas.innerHTML = '<div class="oc-empty-hint">' +
          (setupMissing
            ? 'The org chart database setup hasn\u2019t been completed yet.'
            : 'Couldn\u2019t load the org chart right now. Try refreshing.') +
          '</div>';
        console.error('OrgChart load failed:', error);
        return;
      }
      rows = data || [];
      render();
    }

    function render() {
      renderToolbar();
      if (!rows.length) {
        els.canvas.style.width = '100%';
        els.canvas.style.height = '620px';
        els.canvas.innerHTML = '<div class="oc-empty-hint">No one on the chart yet.' +
          (isAdmin ? '<br><button class="oc-btn oc-btn-solid" data-oc-first style="margin-top:14px;">Add first person</button>' : '') +
          '</div>';
        const firstBtn = els.canvas.querySelector('[data-oc-first]');
        if (firstBtn) firstBtn.onclick = function () { openPersonModal('add', { manager_id: null }); };
        return;
      }

      const layout = layoutTree(rows);
      const byId = nodesById();
      rows.forEach(function (row) {
        const hasSavedPosition = row.position_x !== null && row.position_x !== undefined &&
          row.position_y !== null && row.position_y !== undefined;
        const x = Number(row.position_x), y = Number(row.position_y);
        if (hasSavedPosition && Number.isFinite(x) && Number.isFinite(y)) layout.positions[row.id] = { x: x, y: y };
      });
      layout.edges = relationshipEdges(rows, layout.positions, 'manager_id');
      layout.dottedEdges = relationshipEdges(rows, layout.positions, 'dotted_manager_id');

      let maxX = 600, maxY = 620;
      Object.keys(layout.positions).forEach(function (id) {
        maxX = Math.max(maxX, layout.positions[id].x + NODE_W / 2 + 70);
        maxY = Math.max(maxY, layout.positions[id].y + NODE_H / 2 + 70);
      });
      const width = Math.max(layout.width, maxX, 900);
      const height = Math.max(layout.height, maxY, 620);
      els.canvas.style.width = width + 'px';
      els.canvas.style.height = height + 'px';

      let svg = '<svg width="' + width + '" height="' + height + '">';

      function drawRelationship(edge, dotted) {
        const field = dotted ? 'dotted_route_x' : 'direct_route_x';
        const type = dotted ? 'dotted' : 'direct';
        const stroke = dotted ? '#6f8fab' : '#8ca9c1';
        const lineWidth = dotted ? 1.5 : 1.7;
        const dash = dotted ? ' stroke-dasharray="5 4"' : '';
        edge.children.forEach(function (child) {
          const row = byId[child.id];
          const childLeft = child.x - NODE_W / 2;
          const allBelow = child.y > edge.parent.y;
          const managerAnchorY = edge.parent.y + (allBelow ? NODE_H / 2 : -NODE_H / 2);
          const joinY = managerAnchorY + (allBelow ? 9 : -9);
          const savedRouteX = Number(row && row[field]);
          const routeX = Number.isFinite(savedRouteX)
            ? savedRouteX
            : Math.min(childLeft, edge.parent.x) - (dotted ? 16 : 9);
          const points = [
            edge.parent.x + ',' + managerAnchorY,
            edge.parent.x + ',' + joinY,
            routeX + ',' + joinY,
            routeX + ',' + child.y,
            childLeft + ',' + child.y
          ].join(' ');
          svg += '<polyline class="oc-line-visible" points="' + points + '" fill="none" stroke="' + stroke +
            '" stroke-width="' + lineWidth + '"' + dash + ' data-oc-line="' + child.id +
            '" data-oc-line-manager="' + edge.parentId + '" data-oc-line-type="' + type + '"/>';
          if (isAdmin) {
            svg += '<polyline class="oc-line-hit" points="' + points +
              '" fill="none" stroke="transparent" stroke-width="14" data-oc-line="' +
              child.id + '" data-oc-line-manager="' + edge.parentId + '" data-oc-line-type="' + type + '"/>';
            svg += '<circle class="oc-line-handle" cx="' + routeX + '" cy="' +
              ((joinY + child.y) / 2) + '" r="5" data-oc-line="' + child.id +
              '" data-oc-line-manager="' + edge.parentId + '" data-oc-line-type="' + type + '"/>';
          }
        });
      }

      (layout.dottedEdges || []).forEach(function (edge) { drawRelationship(edge, true); });
      layout.edges.forEach(function (edge) { drawRelationship(edge, false); });
      svg += '</svg>';

      let cards = '';
      rows.forEach(function (n) {
        const pos = layout.positions[n.id];
        if (!pos) return;
        const isSelected = selectedId === n.id;
        const isMultiSelected = selectedIds.has(n.id);
        const isConnecting = connectFromId === n.id;
        const isDragging = dragId === n.id;
        const classes = ['oc-card'];
        if (isSelected) classes.push('oc-selected');
        if (isMultiSelected) classes.push('oc-multi-selected');
        if (isConnecting) classes.push('oc-connect-source');
        if (isDragging) classes.push('oc-moving');
        if (isAdmin) classes.push('oc-admin');
        if (connectMode) classes.push('oc-connectable');

        const avatar = n.photo_url
          ? '<img class="oc-avatar" src="' + escHtml(n.photo_url) + '" alt="">'
          : '<div class="oc-avatar">' + escHtml(initials(n.name)) + '</div>';
        let expand = '';
        if (isSelected && !connectMode) {
          let pills = '';
          if (n.email) {
            pills += '<a class="oc-icon-btn" href="mailto:' + escHtml(n.email) + '" title="Email" data-oc-stop="1">✉</a>';
            pills += '<a class="oc-icon-btn" href="https://teams.microsoft.com/l/chat/0/0?users=' + escHtml(n.email) + '" target="_blank" rel="noopener" title="Teams" data-oc-stop="1">💬</a>';
          }
          if (isAdmin) {
            pills += '<button class="oc-icon-btn" data-oc-edit="' + n.id + '" title="Edit">✎</button>';
            pills += '<button class="oc-icon-btn" data-oc-add="' + n.id + '" title="Add report">+</button>';
            pills += '<button class="oc-icon-btn oc-danger" data-oc-del="' + n.id + '" title="Delete person">✖</button>';
          }
          expand = '<div class="oc-card-expand">' +
            (n.description ? '<div class="oc-desc">' + escHtml(n.description) + '</div>' : '') +
            '<div class="oc-actions">' + pills + '</div></div>';
        }
        cards += '<div class="' + classes.join(' ') + '" style="left:' + pos.x + 'px;top:' + pos.y + 'px;" data-oc-card="' + n.id + '">' +
          (isAdmin ? '<label class="oc-select-box" title="Select person"><input type="checkbox" data-oc-select="' + n.id + '"' + (isMultiSelected ? ' checked' : '') + ' aria-label="Select ' + escHtml(n.name) + '"><span></span></label><span class="oc-grip" title="Drag to move">⠿</span>' : '') +
          '<div class="oc-card-top">' + avatar +
            '<div style="min-width:0;padding-right:10px;"><div class="oc-name" title="' + escHtml(n.name) + '">' + escHtml(n.name) + '</div>' +
            '<div class="oc-role" title="' + escHtml(n.role || '') + '">' + escHtml(n.role || '') + '</div></div>' +
          '</div>' + expand + '</div>';
      });
      els.canvas.innerHTML = svg + cards;
      wireConnectorEvents(byId);
      wireCardEvents(byId, layout.positions);
    }

    function wireConnectorEvents(byId) {
      if (!isAdmin) return;
      els.canvas.querySelectorAll('[data-oc-line]').forEach(function (line) {
        line.addEventListener('pointerdown', function (e) {
          if (connectMode || e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          const reportId = line.getAttribute('data-oc-line');
          const type = line.getAttribute('data-oc-line-type');
          const field = type === 'dotted' ? 'dotted_route_x' : 'direct_route_x';
          const report = byId[reportId];
          if (!report) return;
          line.setPointerCapture(e.pointerId);
          els.canvas.classList.add('oc-routing');
          let nextX = e.clientX - els.canvas.getBoundingClientRect().left;
          function onMove(moveEvent) {
            nextX = Math.max(20, moveEvent.clientX - els.canvas.getBoundingClientRect().left);
            els.canvas.querySelectorAll('[data-oc-line="' + reportId + '"][data-oc-line-type="' + type + '"]')
              .forEach(function (part) {
                if (part.tagName.toLowerCase() === 'circle') {
                  part.setAttribute('cx', nextX);
                } else {
                  const points = part.getAttribute('points').split(' ');
                  points[2] = nextX + ',' + points[2].split(',')[1];
                  points[3] = nextX + ',' + points[3].split(',')[1];
                  part.setAttribute('points', points.join(' '));
                }
              });
          }
          async function onUp() {
            line.removeEventListener('pointermove', onMove);
            line.removeEventListener('pointerup', onUp);
            line.removeEventListener('pointercancel', onUp);
            els.canvas.classList.remove('oc-routing');
            report[field] = nextX;
            const update = { updated_at: new Date().toISOString() };
            update[field] = nextX;
            const result = await sb.from(TABLE).update(update).eq('id', reportId);
            if (result.error) showToast('Could not save line route: ' + result.error.message);
            else showToast('Line route saved');
            render();
          }
          line.addEventListener('pointermove', onMove);
          line.addEventListener('pointerup', onUp);
          line.addEventListener('pointercancel', onUp);
        });
      });
    }

    function wireCardEvents(byId, positions) {
      function refreshConnectorGeometry() {
        els.canvas.querySelectorAll('.oc-line-visible, .oc-line-hit').forEach(function (line) {
          const reportId = line.getAttribute('data-oc-line');
          const managerId = line.getAttribute('data-oc-line-manager');
          const type = line.getAttribute('data-oc-line-type');
          const reportPos = positions[reportId], managerPos = positions[managerId];
          if (!reportPos || !managerPos) return;
          const row = byId[reportId];
          const field = type === 'dotted' ? 'dotted_route_x' : 'direct_route_x';
          const childLeft = reportPos.x - NODE_W / 2;
          const allBelow = reportPos.y > managerPos.y;
          const managerAnchorY = managerPos.y + (allBelow ? NODE_H / 2 : -NODE_H / 2);
          const joinY = managerAnchorY + (allBelow ? 9 : -9);
          const savedRouteX = Number(row && row[field]);
          const routeX = Number.isFinite(savedRouteX)
            ? savedRouteX
            : Math.min(childLeft, managerPos.x) - (type === 'dotted' ? 16 : 9);
          line.setAttribute('points', [
            managerPos.x + ',' + managerAnchorY,
            managerPos.x + ',' + joinY,
            routeX + ',' + joinY,
            routeX + ',' + reportPos.y,
            childLeft + ',' + reportPos.y
          ].join(' '));
          const handle = els.canvas.querySelector('.oc-line-handle[data-oc-line="' + reportId +
            '"][data-oc-line-type="' + type + '"]');
          if (handle) {
            handle.setAttribute('cx', routeX);
            handle.setAttribute('cy', (joinY + reportPos.y) / 2);
          }
        });
      }

      els.canvas.querySelectorAll('[data-oc-card]').forEach(function (card) {
        const id = card.getAttribute('data-oc-card');
        card.addEventListener('click', function (e) {
          if (suppressClickId === id) { suppressClickId = null; return; }
          if (e.target.closest('[data-oc-stop]') || e.target.closest('[data-oc-edit],[data-oc-add],[data-oc-del]')) return;
          if (connectMode && isAdmin) return chooseConnectionCard(id);
          if (isAdmin && e.shiftKey) {
            const ids = rows.map(function (row) { return row.id; });
            const from = lastSelectionId ? ids.indexOf(lastSelectionId) : -1;
            const to = ids.indexOf(id);
            if (from >= 0 && to >= 0) {
              ids.slice(Math.min(from, to), Math.max(from, to) + 1).forEach(function (personId) {
                selectedIds.add(personId);
              });
            } else selectedIds.add(id);
            lastSelectionId = id;
            selectedId = null;
          } else {
            selectedId = (selectedId === id) ? null : id;
          }
          render();
        });

        const selectBox = card.querySelector('[data-oc-select]');
        if (selectBox) {
          selectBox.onclick = function (e) {
            e.stopPropagation();
            if (selectBox.checked) selectedIds.add(id); else selectedIds.delete(id);
            lastSelectionId = id;
            selectedId = null;
            render();
          };
        }

        if (isAdmin) {
          card.addEventListener('pointerdown', function (e) {
            if (connectMode || e.button !== 0 || e.target.closest('button,a,.oc-select-box')) return;
            e.preventDefault();
            if (!selectedIds.has(id)) {
              selectedIds.clear();
              selectedIds.add(id);
              lastSelectionId = id;
            }
            const movingIds = Array.from(selectedIds);
            const origins = {};
            movingIds.forEach(function (movingId) {
              origins[movingId] = { x: positions[movingId].x, y: positions[movingId].y };
            });
            const startX = e.clientX, startY = e.clientY;
            let moved = false;
            dragId = id;
            card.setPointerCapture(e.pointerId);
            card.classList.add('oc-moving');
            function onMove(moveEvent) {
              const dx = moveEvent.clientX - startX, dy = moveEvent.clientY - startY;
              if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
              movingIds.forEach(function (movingId) {
                const nextX = Math.max(NODE_W / 2 + 20, origins[movingId].x + dx);
                const nextY = Math.max(NODE_H / 2 + 20, origins[movingId].y + dy);
                positions[movingId] = { x: nextX, y: nextY };
                const movingCard = els.canvas.querySelector('[data-oc-card="' + movingId + '"]');
                if (movingCard) {
                  movingCard.style.left = nextX + 'px';
                  movingCard.style.top = nextY + 'px';
                  movingCard.classList.add('oc-moving');
                }
              });
              refreshConnectorGeometry();
            }
            async function onUp(upEvent) {
              card.removeEventListener('pointermove', onMove);
              card.removeEventListener('pointerup', onUp);
              card.removeEventListener('pointercancel', onUp);
              dragId = null;
              if (!moved) { card.classList.remove('oc-moving'); return; }
              suppressClickId = id;
              const results = await Promise.all(movingIds.map(function (movingId) {
                const pos = positions[movingId];
                byId[movingId].position_x = pos.x;
                byId[movingId].position_y = pos.y;
                return sb.from(TABLE).update({
                  position_x: pos.x, position_y: pos.y, updated_at: new Date().toISOString()
                }).eq('id', movingId);
              }));
              const failed = results.find(function (result) { return result.error; });
              if (failed) showToast('Could not save card positions: ' + failed.error.message);
              else showToast(movingIds.length + (movingIds.length === 1 ? ' card moved' : ' cards moved'));
              render();
            }
            card.addEventListener('pointermove', onMove);
            card.addEventListener('pointerup', onUp);
            card.addEventListener('pointercancel', onUp);
          });
        }

        const editBtn = card.querySelector('[data-oc-edit]');
        if (editBtn) editBtn.onclick = function (e) { e.stopPropagation(); openPersonModal('edit', byId[id]); };
        const addBtn = card.querySelector('[data-oc-add]');
        if (addBtn) addBtn.onclick = function (e) { e.stopPropagation(); openPersonModal('add', { manager_id: id }); };
        const delBtn = card.querySelector('[data-oc-del]');
        if (delBtn) delBtn.onclick = function (e) { e.stopPropagation(); deletePerson(byId[id]); };
      });
    }

    async function chooseConnectionCard(id) {
      const byId = nodesById();
      if (!connectFromId) {
        connectFromId = id;
        renderToolbar(); render();
        showToast('Now choose the report card');
        return;
      }
      if (id === connectFromId) {
        showToast('Choose a different card as the report');
        return;
      }
      const report = byId[id], manager = byId[connectFromId];
      if (connectMode === 'remove') {
        const removesSolid = report.manager_id === connectFromId;
        const removesDotted = report.dotted_manager_id === connectFromId;
        if (!removesSolid && !removesDotted) {
          showToast('Those cards do not have a line between them');
          return;
        }
        const payload = { updated_at: new Date().toISOString() };
        if (removesSolid) payload.manager_id = null;
        if (removesDotted) payload.dotted_manager_id = null;
        const { error } = await sb.from(TABLE).update(payload).eq('id', id);
        if (error) { showToast('Could not remove line: ' + error.message); return; }
        const lineLabel = removesSolid && removesDotted
          ? 'Solid and dotted lines removed'
          : (removesSolid ? 'Solid line removed' : 'Dotted line removed');
        showToast(lineLabel + ': ' + manager.name + ' → ' + report.name);
        connectMode = null; connectFromId = null;
        await loadData();
        return;
      }
      if (connectMode === 'manager_id' && getDescendantIds(rows, id).has(connectFromId)) {
        showToast('That solid line would create a reporting loop');
        return;
      }
      if (connectMode === 'manager_id' && report.dotted_manager_id === connectFromId) {
        showToast('This person already has that matrix manager');
        return;
      }
      if (connectMode === 'dotted_manager_id' && report.manager_id === connectFromId) {
        showToast('This person already has that direct manager');
        return;
      }
      const field = connectMode;
      const payload = { updated_at: new Date().toISOString() };
      payload[field] = connectFromId;
      const { error } = await sb.from(TABLE).update(payload).eq('id', id);
      if (error) { showToast('Could not create line: ' + error.message); return; }
      const label = field === 'manager_id' ? 'Solid' : 'Dotted';
      showToast(label + ' line added: ' + manager.name + ' → ' + report.name);
      connectMode = null; connectFromId = null;
      await loadData();
    }

    async function autoArrange() {
      if (!rows.length) return;
      const layout = layoutTree(rows);
      const results = await Promise.all(rows.map(function (row) {
        const pos = layout.positions[row.id];
        if (!pos) return Promise.resolve({ error: null });
        return sb.from(TABLE).update({
          position_x: pos.x, position_y: pos.y, updated_at: new Date().toISOString()
        }).eq('id', row.id);
      }));
      const failed = results.find(function (result) { return result.error; });
      if (failed) { showToast('Could not auto arrange: ' + failed.error.message); return; }
      showToast('Chart auto arranged');
      await loadData();
    }

    async function deleteSelectedPeople() {
      const ids = Array.from(selectedIds);
      if (!ids.length) return;
      const names = rows.filter(function (row) { return selectedIds.has(row.id); })
        .map(function (row) { return row.name; });
      if (!confirm('Delete ' + ids.length + ' selected ' + (ids.length === 1 ? 'person' : 'people') +
        '? Unselected reports will be preserved.\n\n' + names.join(', '))) return;

      const byId = nodesById();
      function nearestRemainingManager(managerId) {
        const visited = new Set();
        while (managerId && selectedIds.has(managerId) && !visited.has(managerId)) {
          visited.add(managerId);
          managerId = byId[managerId] ? byId[managerId].manager_id : null;
        }
        return managerId || null;
      }

      const affected = rows.filter(function (row) {
        return !selectedIds.has(row.id) &&
          (selectedIds.has(row.manager_id) || selectedIds.has(row.dotted_manager_id));
      });
      const moves = await Promise.all(affected.map(function (row) {
        const payload = { updated_at: new Date().toISOString() };
        if (selectedIds.has(row.manager_id)) payload.manager_id = nearestRemainingManager(row.manager_id);
        if (selectedIds.has(row.dotted_manager_id)) payload.dotted_manager_id = null;
        return sb.from(TABLE).update(payload).eq('id', row.id);
      }));
      const moveFailure = moves.find(function (result) { return result.error; });
      if (moveFailure) { showToast('Could not preserve reports: ' + moveFailure.error.message); return; }

      const result = await sb.from(TABLE).delete().in('id', ids);
      if (result.error) { showToast('Could not delete selected people: ' + result.error.message); return; }
      selectedIds.clear();
      lastSelectionId = null;
      selectedId = null;
      showToast('Deleted ' + ids.length + (ids.length === 1 ? ' person' : ' people'));
      await loadData();
    }

    async function deletePerson(node) {
      if (!node) return;
      const hasReports = rows.some(function (r) { return r.manager_id === node.id; });
      const reportNote = hasReports
        ? (node.manager_id
            ? ' Their direct reports will move up to their manager.'
            : ' Their direct reports will become top-level people.')
        : '';
      if (!confirm('Delete ' + node.name + '?' + reportNote)) return;

      // Preserve the rest of the chart before deleting: reports move up one
      // level, or become top-level when deleting a top-level person.
      const { error: moveErr } = await sb.from(TABLE)
        .update({ manager_id: node.manager_id || null, updated_at: new Date().toISOString() })
        .eq('manager_id', node.id);
      if (moveErr) { showToast('Could not delete: ' + moveErr.message); return; }

      const { error: delErr } = await sb.from(TABLE).delete().eq('id', node.id);
      if (delErr) { showToast('Could not delete: ' + delErr.message); return; }
      selectedId = null;
      showToast('Deleted ' + node.name);
      await loadData();
    }

    function openPersonModal(mode, seed) {
      const isEdit = mode === 'edit';
      const data = isEdit
        ? {
            id: seed.id, name: seed.name || '', role: seed.role || '', email: seed.email || '',
            description: seed.description || '', photo_url: seed.photo_url || null,
            manager_id: seed.manager_id || null, dotted_manager_id: seed.dotted_manager_id || null
          }
        : {
            manager_id: seed.manager_id || null, dotted_manager_id: null,
            name: '', role: '', email: '', description: '', photo_url: null
          };
      let pendingPhotoFile = null;

      const directExcluded = isEdit ? getDescendantIds(rows, data.id) : new Set();
      if (isEdit) directExcluded.add(data.id);
      function managerOptions(selectedId, excluded, emptyLabel) {
        return '<option value="">' + emptyLabel + '</option>' + rows
          .filter(function (person) { return !excluded.has(person.id); })
          .map(function (person) {
            return '<option value="' + person.id + '"' + (person.id === selectedId ? ' selected' : '') + '>' +
              escHtml(person.name) + (person.role ? ' — ' + escHtml(person.role) : '') + '</option>';
          }).join('');
      }
      const dottedExcluded = new Set(isEdit ? [data.id] : []);

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
            '<label class="oc-field-label">Direct manager <span style="font-weight:400;text-transform:none;">(solid line)</span></label>' +
            '<select class="oc-input" name="manager_id">' +
              managerOptions(data.manager_id, directExcluded, 'No direct manager — top level') +
            '</select>' +
            '<label class="oc-field-label">Matrix manager <span style="font-weight:400;text-transform:none;">(dotted line)</span></label>' +
            '<select class="oc-input" name="dotted_manager_id">' +
              managerOptions(data.dotted_manager_id, dottedExcluded, 'No dotted-line manager') +
            '</select>' +
            '<label class="oc-field-label">Email</label>' +
            '<input class="oc-input" name="email" type="email" value="' + escHtml(data.email) + '" placeholder="name@pepsico.com">' +
            '<label class="oc-field-label">Description</label>' +
            '<textarea class="oc-textarea" name="description" placeholder="Department, responsibilities, or team notes">' + escHtml(data.description) + '</textarea>' +
            '<div class="oc-error" data-oc="saveError" style="margin-top:12px;"></div>' +
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
          manager_id: form.manager_id.value || null,
          dotted_manager_id: form.dotted_manager_id.value || null,
          updated_at: new Date().toISOString()
        };

        const saveError = form.querySelector('[data-oc="saveError"]');
        if (payload.manager_id && payload.manager_id === payload.dotted_manager_id) {
          saveError.textContent = 'Direct manager and matrix manager must be different people.';
          submitBtn.disabled = false;
          return;
        }

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
          const denied = err && (err.code === '42501' || /permission denied/i.test(err.message || ''));
          saveError.textContent = denied
            ? 'Your signed-in account is not recognised by the org chart write policy. Run the latest 17_org_chart.sql migration and try again.'
            : (err.message || 'Something went wrong saving this.');
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
    mountPage: function (containerEl, options) {
      const c = createController(containerEl, options);
      c.init();
      return c;
    }
  };
})();
