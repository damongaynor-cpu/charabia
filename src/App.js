import { useState, useEffect, useRef, useCallback } from "react";

// ─── Load external scripts at runtime ───────────────────────────────────────
const loadScript = (src) => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) return res();
  const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej;
  document.head.appendChild(s);
});

// Pre-load export libs + Firebase
Promise.all([
  loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"),
  loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"),
  loadScript("https://unpkg.com/docx@8.5.0/build/index.js"),
]).catch(() => {});

// ─── Firebase config — replace these values with your own from Firebase Console ──
// See FIREBASE_SETUP.md (included in your project) for step-by-step instructions
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
const FIREBASE_ENABLED = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";

// ─── Firebase loader (dynamic import to avoid breaking offline use) ──────────
let firebaseApp, firebaseDb, firebaseAuth, firebaseGoogleProvider;
const initFirebase = async () => {
  if (!FIREBASE_ENABLED || firebaseApp) return !!firebaseApp;
  try {
    const [
      { initializeApp },
      { getFirestore, doc, setDoc, onSnapshot, collection },
      { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged },
    ] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js"),
    ]);
    firebaseApp = initializeApp(FIREBASE_CONFIG);
    firebaseDb  = { getFirestore, doc, setDoc, onSnapshot, collection, db: getFirestore(firebaseApp) };
    firebaseAuth = { getAuth, auth: getAuth(firebaseApp), onAuthStateChanged, signOut };
    firebaseGoogleProvider = new GoogleAuthProvider();
    window._firebaseSignIn  = () => signInWithPopup(firebaseAuth.auth, firebaseGoogleProvider);
    window._firebaseSignOut = () => signOut(firebaseAuth.auth);
    return true;
  } catch (e) {
    console.warn("Firebase init failed:", e);
    return false;
  }
};

// ─── Utility helpers ────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const fmt = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

// ─── Default folder structure ────────────────────────────────────────────────
const defaultFolders = [
  { id: "chapters",    name: "Chapters",      icon: "📖", color: "#1a1a1a", locked: false },
  { id: "characters",  name: "Characters",    icon: "👤", color: "#2a2a2a", locked: false },
  { id: "settings",    name: "Settings",      icon: "🏛️", color: "#2a2a2a", locked: false },
  { id: "brainstorm",  name: "Brainstorm",    icon: "💡", color: "#2a2a2a", locked: false },
  { id: "research",    name: "Research",      icon: "📚", color: "#2a2a2a", locked: false },
  { id: "ai-research", name: "AI Research",   icon: "🔭", color: "#444",    locked: true  },
];

const defaultDocs = [
  { id: uid(), folderId: "chapters",   title: "Chapter 1 – The Beginning", content: "<p>Begin your story here...</p>", updatedAt: now(), wordCount: 0 },
  { id: uid(), folderId: "characters", title: "Protagonist",               content: "<p>Describe your main character...</p>", updatedAt: now(), wordCount: 0 },
];

// ─── Toolbar button component ────────────────────────────────────────────────
const TB = ({ cmd, arg, title, children, active }) => {
  const exec = (e) => { e.preventDefault(); document.execCommand(cmd, false, arg ?? null); };
  return (
    <button onMouseDown={exec} title={title}
      style={{ background: active ? "rgba(0,0,0,0.08)" : "transparent", border: "none",
        color: active ? "#000" : "#555", cursor: "pointer", padding: "4px 7px",
        borderRadius: 2, fontSize: 13, fontFamily: "'Special Elite', 'Courier New', monospace", transition: "all .1s" }}
      onMouseEnter={e => e.target.style.color = "#000"}
      onMouseLeave={e => e.target.style.color = active ? "#000" : "#555"}
    >{children}</button>
  );
};

// ─── Main App ────────────────────────────────────────────────────────────────
export default function WriterApp() {
  const [folders, setFolders]   = useState(defaultFolders);
  const [docs, setDocs]         = useState(defaultDocs);
  const [activeDoc, setActiveDoc] = useState(defaultDocs[0].id);
  const [openFolders, setOpenFolders] = useState({ chapters: true, characters: false, settings: false, brainstorm: false, research: false, "ai-research": true });
  const [saveStatus, setSaveStatus] = useState("saved");
  const [searchQ, setSearchQ]   = useState("");
  const [showNewDoc, setShowNewDoc] = useState(null);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [researchLoading, setResearchLoading] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [sidebarW, setSidebarW] = useState(260);
  const [rightW, setRightW]     = useState(300);
  const [showRight, setShowRight] = useState(true);
  const [renaming, setRenaming] = useState(null);
  const [renameVal, setRenameVal] = useState("");
  const [charLoading, setCharLoading] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [cloudUser, setCloudUser]   = useState(null);
  const [cloudStatus, setCloudStatus] = useState("local");
  const [showCloudMenu, setShowCloudMenu] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null); // { message, onConfirm }
  const cloudUnsub = useRef(null);
  const cloudSaveTimer = useRef(null);
  const editorRef = useRef(null);
  const saveTimer = useRef(null);
  const researchTimer = useRef(null);
  const charTimer = useRef(null);
  const draggingRef = useRef(null);

  const doc = docs.find(d => d.id === activeDoc);
  const aiDocs = docs.filter(d => d.folderId === "ai-research");

  // ── Load / persist ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Always load from localStorage first for instant start
    const saved = localStorage.getItem("writerapp_v1");
    if (saved) {
      try {
        const { folders: f, docs: d, openFolders: o } = JSON.parse(saved);
        if (f) setFolders(f);
        if (d) { setDocs(d); setActiveDoc(d[0]?.id); }
        if (o) setOpenFolders(o);
      } catch {}
    }
    // Try to init Firebase and listen for auth changes
    initFirebase().then(ok => {
      if (!ok) return;
      firebaseAuth.onAuthStateChanged(firebaseAuth.auth, user => {
        setCloudUser(user || null);
        if (user) subscribeCloud(user.uid);
        else { if (cloudUnsub.current) { cloudUnsub.current(); cloudUnsub.current = null; } setCloudStatus("local"); }
      });
    });
    return () => { if (cloudUnsub.current) cloudUnsub.current(); };
  }, []);

  // ── Subscribe to Firestore realtime updates ──────────────────────────────────
  const subscribeCloud = (uid) => {
    if (cloudUnsub.current) cloudUnsub.current();
    const { db, doc: fsDoc, onSnapshot } = firebaseDb;
    const ref = fsDoc(db, "users", uid, "charabia", "data");
    setCloudStatus("syncing");
    cloudUnsub.current = onSnapshot(ref, snap => {
      if (snap.exists()) {
        const { folders: f, docs: d, openFolders: o } = snap.data();
        if (f) setFolders(f);
        if (d) { setDocs(d); setActiveDoc(prev => d.find(x => x.id === prev) ? prev : d[0]?.id); }
        if (o) setOpenFolders(o);
        setCloudStatus("synced");
      } else {
        // First time — push local data to cloud
        pushToCloud(uid);
      }
    }, () => setCloudStatus("error"));
  };

  const pushToCloud = useCallback((uid, newDocs, newFolders, newOpen) => {
    if (!firebaseDb || !uid) return;
    const { db, doc: fsDoc, setDoc: fsSet } = firebaseDb;
    const data = {
      folders: newFolders ?? folders,
      docs: newDocs ?? docs,
      openFolders: newOpen ?? openFolders,
      updatedAt: new Date().toISOString(),
    };
    setCloudStatus("syncing");
    fsSet(fsDoc(db, "users", uid, "charabia", "data"), data)
      .then(() => setCloudStatus("synced"))
      .catch(() => setCloudStatus("error"));
  }, [folders, docs, openFolders]);

  const persist = useCallback((newDocs, newFolders, newOpen) => {
    // Always save locally
    localStorage.setItem("writerapp_v1", JSON.stringify({
      folders: newFolders ?? folders,
      docs: newDocs ?? docs,
      openFolders: newOpen ?? openFolders,
    }));
    // Debounce cloud save
    if (cloudUser) {
      clearTimeout(cloudSaveTimer.current);
      cloudSaveTimer.current = setTimeout(() => pushToCloud(cloudUser.uid, newDocs, newFolders, newOpen), 2000);
    }
  }, [folders, docs, openFolders, cloudUser, pushToCloud]);

  // ── Auto-save logic ─────────────────────────────────────────────────────────
  const scheduleAutoSave = useCallback((newDocs) => {
    setSaveStatus("saving…");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      persist(newDocs);
      setSaveStatus("saved");
    }, 1200);
  }, [persist]);

  // ── Editor input ─────────────────────────────────────────────────────────────
  const onEditorInput = useCallback(() => {
    if (!editorRef.current || !doc) return;
    const html = editorRef.current.innerHTML;
    const text = editorRef.current.innerText || "";
    const wc = text.trim() ? text.trim().split(/\s+/).length : 0;
    setWordCount(wc);
    const updated = docs.map(d => d.id === doc.id ? { ...d, content: html, wordCount: wc, updatedAt: now() } : d);
    setDocs(updated);
    scheduleAutoSave(updated);

    // Schedule AI research only for chapter docs
    if (doc.folderId === "chapters") {
      clearTimeout(researchTimer.current);
      researchTimer.current = setTimeout(() => triggerAIResearch(text, doc), 5000);
      clearTimeout(charTimer.current);
      charTimer.current = setTimeout(() => detectCharacters(text), 7000);
    }
  }, [doc, docs, scheduleAutoSave]);

  // ── Set editor content when switching docs ──────────────────────────────────
  useEffect(() => {
    if (editorRef.current && doc) {
      if (editorRef.current.innerHTML !== doc.content) {
        editorRef.current.innerHTML = doc.content || "";
      }
      const text = editorRef.current.innerText || "";
      setWordCount(text.trim() ? text.trim().split(/\s+/).length : 0);
    }
  }, [activeDoc]);

  // ── AI Research ──────────────────────────────────────────────────────────────
  const triggerAIResearch = async (text, sourceDoc, isSelection = false) => {
    if (!text || text.trim().split(/\s+/).length < 5) return;
    setResearchLoading(true);
    try {
      const snippet = text.slice(0, 800);
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: snippet, docTitle: sourceDoc.title, isSelection }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error);
      const parsed = data.result;
      const time = new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
      const label = isSelection ? `✂️ Selection [${time}]` : `🔭 ${sourceDoc.title} [${time}]`;

      const newDoc = {
        id: uid(),
        folderId: "ai-research",
        title: label,
        content: buildResearchHTML(parsed.suggestions, isSelection ? `Selected passage — ${sourceDoc.title}` : sourceDoc.title, isSelection ? snippet : null),
        updatedAt: now(),
        wordCount: 0,
        sourceDocId: sourceDoc.id,
      };
      setDocs(prev => {
        const updated = [...prev, newDoc];
        persist(updated);
        return updated;
      });
      setOpenFolders(prev => ({ ...prev, "ai-research": true }));
    } catch (e) {
      console.error("AI research error:", e);
    }
    setResearchLoading(false);
  };

  // ── Auto-detect character names from chapter text ────────────────────────────
  const detectCharacters = async (text) => {
    if (!text || text.trim().split(/\s+/).length < 15) return;
    setCharLoading(true);
    try {
      const response = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 800) }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error);
      const names = data.names;
      if (!Array.isArray(names) || names.length === 0) return;

      setDocs(prev => {
        const existingCharTitles = prev
          .filter(d => d.folderId === "characters")
          .map(d => d.title.toLowerCase());

        const newCharDocs = names
          .filter(name => name && name.trim())
          .filter(name => !existingCharTitles.includes(name.trim().toLowerCase()))
          .map(name => ({
            id: uid(),
            folderId: "characters",
            title: name.trim(),
            content: `<p><strong>${name.trim()}</strong></p><p>Role: </p><p>Description: </p><p>Traits: </p><p>Notes: </p>`,
            updatedAt: now(),
            wordCount: 0,
            autoCreated: true,
          }));

        if (newCharDocs.length === 0) return prev;

        const updated = [...prev, ...newCharDocs];
        persist(updated);
        setOpenFolders(p => ({ ...p, characters: true }));
        return updated;
      });
    } catch (e) {
      console.error("Character detection error:", e);
    }
    setCharLoading(false);
  };

  const buildResearchHTML = (suggestions, sourceTitle, selectionQuote = null) => {
    const quoteBlock = selectionQuote
      ? `<blockquote style="border-left:3px solid #555;padding:8px 12px;margin:0 0 16px;font-style:italic;color:#444;font-size:12px;background:rgba(0,0,0,0.03);font-family:'Special Elite','Courier New',monospace">"${selectionQuote.slice(0,200)}${selectionQuote.length > 200 ? "…" : ""}"</blockquote>`
      : "";
    return `<h2 style="color:#111;font-family:'Special Elite','Courier New',monospace;border-bottom:1px solid #bbb;padding-bottom:8px;margin-bottom:14px;letter-spacing:1px;font-size:15px">Research: ${sourceTitle}</h2>
${quoteBlock}${suggestions.map(s => `
<div style="margin-bottom:16px;padding:10px 12px;background:rgba(0,0,0,0.03);border-left:3px solid #333;font-family:'Special Elite','Courier New',monospace">
  <strong style="color:#111;font-size:13px">${s.topic}</strong>
  <p style="color:#555;margin:5px 0 7px;font-size:12px">${s.why}</p>
  <div style="font-size:11px;color:#777">Search: ${s.queries.map(q => `<span style="background:rgba(0,0,0,0.06);padding:2px 7px;margin:2px;display:inline-block;border:1px solid #ccc">${q}</span>`).join(" ")}</div>
</div>`).join("")}`;
  };

  // ── Manual AI research trigger ───────────────────────────────────────────────
  const manualResearch = () => {
    if (!doc || doc.folderId !== "chapters") return;
    // Prefer selected text; fall back to full doc text
    const sel = window.getSelection();
    const selText = sel && sel.rangeCount > 0 ? sel.toString().trim() : "";
    const text = selText || editorRef.current?.innerText || "";
    triggerAIResearch(text, doc, !!selText);
  };

  // ── Track text selection in editor ───────────────────────────────────────────
  const onSelectionChange = useCallback(() => {
    if (!editorRef.current) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current.contains(sel.anchorNode)) {
      setSelectedText(sel.toString().trim());
    } else {
      setSelectedText("");
    }
  }, []);

  // ── Document management ──────────────────────────────────────────────────────
  const createDoc = (folderId) => {
    if (!newDocTitle.trim()) return;
    const d = { id: uid(), folderId, title: newDocTitle.trim(), content: "<p></p>", updatedAt: now(), wordCount: 0 };
    const updated = [...docs, d];
    setDocs(updated);
    persist(updated);
    setActiveDoc(d.id);
    setShowNewDoc(null);
    setNewDocTitle("");
  };

  const deleteDoc = (id) => {
    setConfirmModal({
      message: "Delete this document?",
      onConfirm: () => {
        const updated = docs.filter(d => d.id !== id);
        setDocs(updated);
        persist(updated);
        if (activeDoc === id) setActiveDoc(updated[0]?.id);
      }
    });
  };

  const renameDoc = (id) => {
    const updated = docs.map(d => d.id === id ? { ...d, title: renameVal } : d);
    setDocs(updated);
    persist(updated);
    setRenaming(null);
  };

  const createFolder = () => {
    if (!newFolderName.trim()) return;
    const icons = ["📁","✍️","🗺️","💭","🔖","📝"];
    const colors = ["#1a1a1a","#2a2a2a","#333","#444","#555","#666"];
    const idx = folders.length % 6;
    const f = { id: uid(), name: newFolderName.trim(), icon: icons[idx], color: colors[idx], locked: false };
    const updated = [...folders, f];
    setFolders(updated);
    persist(null, updated);
    setShowNewFolder(false);
    setNewFolderName("");
  };

  // ── Manual character scan trigger ────────────────────────────────────────────
  const manualScanCharacters = () => {
    // Scan all chapter docs combined
    const allChapterText = docs
      .filter(d => d.folderId === "chapters")
      .map(d => {
        const div = document.createElement("div");
        div.innerHTML = d.content;
        return div.innerText || "";
      })
      .join("\n\n");
    if (allChapterText.trim()) detectCharacters(allChapterText);
  };

  const deleteFolder = (fid) => {
    setConfirmModal({
      message: "Delete folder and all its documents?",
      onConfirm: () => {
        const updated = folders.filter(f => f.id !== fid);
        const updatedDocs = docs.filter(d => d.folderId !== fid);
        setFolders(updated);
        setDocs(updatedDocs);
        persist(updatedDocs, updated);
      }
    });
  };

  // ── Export helpers ────────────────────────────────────────────────────────────
  const safeFilename = (title) => title.replace(/[^a-z0-9\-_\s]/gi, "").trim().replace(/\s+/g, "_") || "document";

  // Parse HTML content into structured blocks for docx
  const parseHTMLToBlocks = (htmlStr) => {
    const div = document.createElement("div");
    div.innerHTML = htmlStr;
    const blocks = [];
    const walk = (node) => {
      if (node.nodeType === 3) { // text node
        const t = node.textContent;
        if (t.trim()) blocks.push({ type: "p", text: t, bold: false, italic: false });
        return;
      }
      const tag = node.tagName?.toLowerCase();
      if (!tag) return;
      const text = node.innerText || node.textContent || "";
      if (!text.trim() && tag !== "br") { node.childNodes.forEach(walk); return; }
      if (tag === "h1") blocks.push({ type: "h1", text: text.trim() });
      else if (tag === "h2") blocks.push({ type: "h2", text: text.trim() });
      else if (tag === "h3") blocks.push({ type: "h3", text: text.trim() });
      else if (tag === "blockquote") blocks.push({ type: "bq", text: text.trim() });
      else if (tag === "li") blocks.push({ type: "li", text: text.trim() });
      else if (tag === "br") blocks.push({ type: "br" });
      else if (["p","div","section","article"].includes(tag)) {
        const bold = !!node.querySelector("strong, b");
        const italic = !!node.querySelector("em, i");
        if (text.trim()) blocks.push({ type: "p", text: text.trim(), bold, italic });
        else node.childNodes.forEach(walk);
      } else node.childNodes.forEach(walk);
    };
    div.childNodes.forEach(walk);
    return blocks;
  };

  // ── Export as DOCX ───────────────────────────────────────────────────────────
  const exportDocx = async () => {
    if (!doc) return;
    if (!window.docx) { alert("DOCX library still loading, please try again in a moment."); return; }
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = window.docx;
    const blocks = parseHTMLToBlocks(doc.content);

    const children = [
      // Document title
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: doc.title, bold: true, size: 36, font: "Georgia" })],
        spacing: { after: 320 },
      }),
      ...blocks.map(b => {
        if (b.type === "h1") return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: b.text, bold: true, size: 32, font: "Georgia" })] });
        if (b.type === "h2") return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: b.text, bold: true, size: 28, font: "Georgia" })] });
        if (b.type === "h3") return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: b.text, bold: true, size: 24, font: "Georgia" })] });
        if (b.type === "bq") return new Paragraph({
          indent: { left: 720 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: "888888", space: 12 } },
          children: [new TextRun({ text: b.text, italics: true, color: "555555", font: "Georgia", size: 24 })],
          spacing: { before: 160, after: 160 },
        });
        if (b.type === "li") return new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: b.text, font: "Georgia", size: 24 })],
          spacing: { after: 80 },
        });
        if (b.type === "br") return new Paragraph({ children: [new TextRun("")] });
        return new Paragraph({
          children: [new TextRun({ text: b.text, bold: b.bold, italics: b.italic, font: "Georgia", size: 24 })],
          spacing: { after: 160 },
          alignment: AlignmentType.JUSTIFIED,
        });
      }),
    ];

    const docxDoc = new Document({
      styles: {
        default: { document: { run: { font: "Georgia", size: 24, color: "1a1a1a" } } },
      },
      sections: [{
        properties: {
          page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
        },
        children,
      }],
    });

    const buffer = await Packer.toBlob(docxDoc);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(buffer);
    a.download = `${safeFilename(doc.title)}.docx`;
    a.click();
  };

  // ── Export as PDF ────────────────────────────────────────────────────────────
  const exportPdf = async () => {
    if (!doc) return;
    if (!window.jspdf?.jsPDF) { alert("PDF library still loading, please try again in a moment."); return; }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 72; // 1 inch
    const contentW = pageW - margin * 2;
    let y = margin;

    const addPage = () => { pdf.addPage(); y = margin; };
    const checkY = (h) => { if (y + h > pageH - margin) addPage(); };

    // Title
    pdf.setFont("times", "bold");
    pdf.setFontSize(22);
    pdf.setTextColor(30, 20, 10);
    const titleLines = pdf.splitTextToSize(doc.title, contentW);
    checkY(titleLines.length * 28);
    pdf.text(titleLines, margin, y);
    y += titleLines.length * 28 + 16;

    // Separator line
    pdf.setDrawColor(180, 150, 100);
    pdf.setLineWidth(0.75);
    pdf.line(margin, y, pageW - margin, y);
    y += 20;

    const blocks = parseHTMLToBlocks(doc.content);
    blocks.forEach(b => {
      if (b.type === "h1") {
        pdf.setFont("times", "bold"); pdf.setFontSize(18); pdf.setTextColor(30, 20, 10);
        const lines = pdf.splitTextToSize(b.text, contentW);
        checkY(lines.length * 24 + 16);
        y += 8; pdf.text(lines, margin, y); y += lines.length * 24 + 8;
      } else if (b.type === "h2") {
        pdf.setFont("times", "bold"); pdf.setFontSize(15); pdf.setTextColor(50, 35, 15);
        const lines = pdf.splitTextToSize(b.text, contentW);
        checkY(lines.length * 20 + 12);
        y += 4; pdf.text(lines, margin, y); y += lines.length * 20 + 6;
      } else if (b.type === "h3") {
        pdf.setFont("times", "bolditalic"); pdf.setFontSize(13); pdf.setTextColor(60, 45, 20);
        const lines = pdf.splitTextToSize(b.text, contentW);
        checkY(lines.length * 18 + 10);
        pdf.text(lines, margin, y); y += lines.length * 18 + 6;
      } else if (b.type === "bq") {
        pdf.setFont("times", "italic"); pdf.setFontSize(11); pdf.setTextColor(80, 70, 55);
        const lines = pdf.splitTextToSize(b.text, contentW - 30);
        checkY(lines.length * 16 + 12);
        pdf.setDrawColor(160, 130, 80); pdf.setLineWidth(2);
        pdf.line(margin + 8, y - 8, margin + 8, y + lines.length * 16);
        pdf.text(lines, margin + 20, y); y += lines.length * 16 + 10;
      } else if (b.type === "li") {
        pdf.setFont("times", "normal"); pdf.setFontSize(11); pdf.setTextColor(30, 20, 10);
        const lines = pdf.splitTextToSize("• " + b.text, contentW - 16);
        checkY(lines.length * 15 + 4);
        pdf.text(lines, margin + 12, y); y += lines.length * 15 + 4;
      } else if (b.type === "br") {
        y += 8;
      } else {
        const style = b.bold ? "bold" : b.italic ? "italic" : "normal";
        pdf.setFont("times", style); pdf.setFontSize(12); pdf.setTextColor(25, 18, 8);
        const lines = pdf.splitTextToSize(b.text, contentW);
        checkY(lines.length * 18 + 6);
        pdf.text(lines, margin, y, { align: "justify", maxWidth: contentW });
        y += lines.length * 18 + 6;
      }
    });

    // Footer with page numbers
    const pageCount = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);
      pdf.setFont("times", "italic"); pdf.setFontSize(9); pdf.setTextColor(150, 120, 80);
      pdf.text(doc.title, margin, pageH - 40);
      pdf.text(`${i} / ${pageCount}`, pageW - margin, pageH - 40, { align: "right" });
      pdf.setDrawColor(180, 150, 100); pdf.setLineWidth(0.5);
      pdf.line(margin, pageH - 52, pageW - margin, pageH - 52);
    }

    pdf.save(`${safeFilename(doc.title)}.pdf`);
  };

  // ── Save to PC (HTML) ─────────────────────────────────────────────────────────
  const saveLocal = () => {
    if (!doc) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${doc.title}</title>
<style>body{font-family:Georgia,serif;max-width:800px;margin:60px auto;line-height:1.8;color:#222;padding:0 20px}h1{border-bottom:1px solid #ccc;padding-bottom:8px}</style></head>
<body><h1>${doc.title}</h1><div>${doc.content}</div></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${safeFilename(doc.title)}.html`;
    a.click();
  };

  const saveAllLocal = () => {
    const data = JSON.stringify({ folders, docs }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `writer_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  };

  const importBackup = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const { folders: f, docs: d } = JSON.parse(ev.target.result);
        if (f) setFolders(f);
        if (d) { setDocs(d); setActiveDoc(d[0]?.id); }
        persist(d, f);
        alert("Backup imported successfully!");
      } catch { alert("Invalid backup file."); }
    };
    reader.readAsText(file);
  };

  // ── Search filter ────────────────────────────────────────────────────────────
  const filteredDocs = (fid) => docs.filter(d => d.folderId === fid &&
    (!searchQ || d.title.toLowerCase().includes(searchQ.toLowerCase()) ||
     (editorRef.current?.innerText || "").toLowerCase().includes(searchQ.toLowerCase()))
  );

  // ── Sidebar resize ───────────────────────────────────────────────────────────
  const startSidebarResize = (e) => {
    draggingRef.current = { type: "sidebar", startX: e.clientX, startW: sidebarW };
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", stopDrag);
  };
  const startRightResize = (e) => {
    draggingRef.current = { type: "right", startX: e.clientX, startW: rightW };
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", stopDrag);
  };
  const onDrag = (e) => {
    if (!draggingRef.current) return;
    const delta = e.clientX - draggingRef.current.startX;
    if (draggingRef.current.type === "sidebar") setSidebarW(Math.max(180, Math.min(400, draggingRef.current.startW + delta)));
    if (draggingRef.current.type === "right")   setRightW(Math.max(200, Math.min(480, draggingRef.current.startW - delta)));
  };
  const stopDrag = () => { draggingRef.current = null; document.removeEventListener("mousemove", onDrag); document.removeEventListener("mouseup", stopDrag); };

  // ── Styles ───────────────────────────────────────────────────────────────────
  const S = {
    app: { display: "flex", height: "100vh", background: "#f5f2ed", color: "#1a1a1a", fontFamily: "'Special Elite', 'Courier New', monospace", overflow: "hidden" },
    sidebar: { width: sidebarW, minWidth: sidebarW, display: "flex", flexDirection: "column", background: "#eeeae3", borderRight: "2px solid #ccc8c0", overflow: "hidden" },
    sidebarHeader: { padding: "18px 16px 12px", borderBottom: "2px solid #ccc8c0" },
    logo: { fontSize: 22, fontFamily: "'Special Elite', 'Courier New', monospace", color: "#111", letterSpacing: 2, marginBottom: 10, textShadow: "1px 1px 0 rgba(0,0,0,0.08)" },
    searchBox: { width: "100%", background: "#fff", border: "1px solid #b0aba0", borderRadius: 0, padding: "6px 10px", color: "#1a1a1a", fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: "'Special Elite', 'Courier New', monospace" },
    folderList: { flex: 1, overflowY: "auto", padding: "8px 0" },
    folderHeader: { display: "flex", alignItems: "center", padding: "6px 12px", cursor: "pointer", userSelect: "none", transition: "background .1s" },
    folderIcon: () => ({ width: 5, height: 5, borderRadius: 0, background: "#555", marginRight: 8, flexShrink: 0, transform: "rotate(45deg)" }),
    folderName: { flex: 1, fontSize: 11, fontWeight: 400, letterSpacing: 1.5, textTransform: "uppercase", color: "#333", fontFamily: "'Special Elite', 'Courier New', monospace" },
    docItem: (active) => ({ padding: "5px 12px 5px 28px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, background: active ? "rgba(0,0,0,0.07)" : "transparent", borderLeft: active ? "3px solid #111" : "3px solid transparent", transition: "all .1s" }),
    docTitle: (active) => ({ flex: 1, fontSize: 12, color: active ? "#000" : "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "'Special Elite', 'Courier New', monospace" }),
    resizer: { width: 4, cursor: "col-resize", background: "transparent", flexShrink: 0, transition: "background .2s" },
    main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f8f5f0" },
    toolbar: { display: "flex", alignItems: "center", gap: 2, padding: "5px 16px", borderBottom: "1px solid #ccc8c0", background: "#eeeae3", flexWrap: "wrap" },
    sep: { width: 1, height: 16, background: "#bbb", margin: "0 5px" },
    editor: { flex: 1, padding: "52px 72px", overflowY: "auto", outline: "none", fontSize: 16, lineHeight: 2, color: "#111", caretColor: "#333", maxWidth: 820, margin: "0 auto", width: "100%" },
    statusBar: { padding: "4px 20px", borderTop: "1px solid #ccc8c0", display: "flex", alignItems: "center", gap: 16, fontSize: 11, color: "#888", background: "#eeeae3", fontFamily: "'Special Elite', 'Courier New', monospace" },
    rightPanel: { width: showRight ? rightW : 0, minWidth: showRight ? rightW : 0, background: "#eeeae3", borderLeft: "2px solid #ccc8c0", display: "flex", flexDirection: "column", overflow: "hidden", transition: "width .2s" },
    rightHeader: { padding: "14px 16px 10px", borderBottom: "2px solid #ccc8c0", display: "flex", alignItems: "center", justifyContent: "space-between" },
    rightContent: { flex: 1, overflowY: "auto", padding: 14 },
    aiDocItem: { padding: "10px 12px", marginBottom: 8, background: "rgba(0,0,0,0.04)", border: "1px solid #ccc8c0", borderRadius: 0, cursor: "pointer", transition: "all .1s" },
    btn: (color = "#111") => ({ background: "transparent", border: `1px solid ${color}`, color, borderRadius: 0, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontFamily: "'Special Elite', 'Courier New', monospace", transition: "all .1s", letterSpacing: .5 }),
    inputBox: { background: "#fff", border: "1px solid #b0aba0", borderRadius: 0, padding: "7px 10px", color: "#111", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "'Special Elite', 'Courier New', monospace" },
  };

  const folder = folders.find(f => f.id === doc?.folderId);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Special+Elite&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #bbb; border-radius: 0; }

        /* Distressed paper texture on main bg */
        body { background: #f5f2ed; }

        [contenteditable]:focus { outline: none; }
        [contenteditable] { font-family: 'Special Elite', 'Courier New', monospace !important; }
        [contenteditable] h1 { font-family: 'Special Elite', 'Courier New', monospace; color: #111; font-size: 26px; margin-bottom: 14px; border-bottom: 1px solid #bbb; padding-bottom: 6px; letter-spacing: 1px; }
        [contenteditable] h2 { font-family: 'Special Elite', 'Courier New', monospace; color: #222; font-size: 20px; margin: 18px 0 8px; letter-spacing: .5px; }
        [contenteditable] h3 { font-family: 'Special Elite', 'Courier New', monospace; color: #333; font-size: 16px; margin: 14px 0 6px; }
        [contenteditable] p { margin-bottom: 14px; color: #1a1a1a; }
        [contenteditable] blockquote { border-left: 3px solid #555; padding-left: 16px; color: #444; font-style: italic; margin: 16px 0; }

        /* Subtle typewriter ink unevenness */
        [contenteditable] { text-shadow: 0.3px 0.3px 0 rgba(0,0,0,0.15), -0.1px 0 0 rgba(0,0,0,0.08); }

        /* Paper grain overlay on the main editor area */
        .editor-wrap {
          position: relative;
        }
        .editor-wrap::before {
          content: '';
          position: absolute; inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
          pointer-events: none; z-index: 1; opacity: .5;
        }

        .folder-row:hover { background: rgba(0,0,0,0.05) !important; }
        .doc-row:hover { background: rgba(0,0,0,0.06) !important; }
        .ai-doc:hover { background: rgba(0,0,0,0.07) !important; border-color: #999 !important; }
        .icon-btn:hover { color: #000 !important; }
        .action-btn:hover { background: rgba(0,0,0,0.07) !important; }
        input::placeholder { color: #aaa; font-family: 'Special Elite', 'Courier New', monospace; }
        select { font-family: 'Special Elite', 'Courier New', monospace !important; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        .pulsing { animation: pulse 1.5s infinite; }

        /* Typewriter key press effect */
        button:active { transform: translateY(1px); }
      `}</style>
      <div style={S.app}>

        {/* ── SIDEBAR ── */}
        <div style={S.sidebar}>
          <div style={S.sidebarHeader}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={S.logo}>// CHARABIA</div>
              {/* Cloud sync indicator */}
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setShowCloudMenu(p => !p)}
                  title={cloudUser ? `Signed in as ${cloudUser.email}` : "Sign in for cloud sync"}
                  style={{ background: "none", border: "1px solid #ccc", borderRadius: 0, padding: "3px 8px", cursor: "pointer", fontSize: 10, fontFamily: "'Special Elite','Courier New',monospace", color: cloudUser ? "#333" : "#aaa", display: "flex", alignItems: "center", gap: 4 }}
                >
                  {cloudUser ? (
                    <>
                      <span style={{ color: cloudStatus === "synced" ? "#4a8a4a" : cloudStatus === "syncing" ? "#888" : "#c0392b", fontSize: 8 }}>●</span>
                      {cloudStatus === "syncing" ? "syncing..." : cloudStatus === "synced" ? "synced" : cloudStatus === "error" ? "error" : "cloud"}
                    </>
                  ) : (
                    <>{FIREBASE_ENABLED ? "☁ sign in" : "☁ setup"}</>
                  )}
                </button>
                {showCloudMenu && (
                  <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: "#fff", border: "1px solid #ccc", zIndex: 100, minWidth: 200, boxShadow: "2px 2px 8px rgba(0,0,0,0.1)", fontFamily: "'Special Elite','Courier New',monospace" }}>
                    {!FIREBASE_ENABLED ? (
                      <div style={{ padding: 12, fontSize: 11, color: "#555", lineHeight: 1.6 }}>
                        Add your Firebase config to enable cloud sync. See FIREBASE_SETUP.md in your project.
                      </div>
                    ) : cloudUser ? (
                      <>
                        <div style={{ padding: "8px 12px", fontSize: 11, color: "#333", borderBottom: "1px solid #eee" }}>{cloudUser.email}</div>
                        <button onClick={() => { window._firebaseSignOut(); setShowCloudMenu(false); }} style={{ width: "100%", padding: "8px 12px", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontSize: 11, fontFamily: "inherit", color: "#555" }}>Sign out</button>
                      </>
                    ) : (
                      <button onClick={() => { window._firebaseSignIn(); setShowCloudMenu(false); }} style={{ width: "100%", padding: "8px 12px", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontSize: 11, fontFamily: "inherit", color: "#333" }}>Sign in with Google</button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <input placeholder="Search documents…" value={searchQ} onChange={e => setSearchQ(e.target.value)} style={S.searchBox} />
          </div>

          <div style={S.folderList}>
            {folders.map(f => (
              <div key={f.id}>
                {/* Folder header */}
                <div className="folder-row" style={{ ...S.folderHeader, justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", flex: 1 }} onClick={() => setOpenFolders(p => ({ ...p, [f.id]: !p[f.id] }))}>
                    <div style={S.folderIcon(f.color)} />
                    <span style={S.folderName}>{f.icon} {f.name}</span>
                    {f.id === "characters" && charLoading && (
                      <span className="pulsing" style={{ fontSize: 9, color: "#aaa", marginLeft: 5, fontFamily: "'Special Elite','Courier New',monospace" }}>scanning...</span>
                    )}
                    <span style={{ color: "#aaa", fontSize: 10, marginLeft: 4 }}>{openFolders[f.id] ? "▾" : "▸"}</span>
                  </div>
                  <div style={{ display: "flex", gap: 2 }}>
                    {!f.locked && (
                      <>
                        <button className="icon-btn" onClick={() => setShowNewDoc(f.id)} style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 14, padding: "0 3px" }} title="New doc">+</button>
                        <button className="icon-btn" onClick={() => deleteFolder(f.id)} style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 11, padding: "0 3px" }} title="Delete folder">×</button>
                      </>
                    )}
                  </div>
                </div>

                {/* New doc input */}
                {showNewDoc === f.id && (
                  <div style={{ padding: "6px 12px 6px 28px", display: "flex", gap: 4 }}>
                    <input autoFocus value={newDocTitle} onChange={e => setNewDocTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") createDoc(f.id); if (e.key === "Escape") setShowNewDoc(null); }}
                      placeholder="Document title…" style={{ ...S.inputBox, fontSize: 12, padding: "4px 8px" }} />
                    <button onClick={() => createDoc(f.id)} style={{ ...S.btn(), fontSize: 11, padding: "4px 8px" }}>✓</button>
                  </div>
                )}

                {/* Characters folder — scan button */}
                {f.id === "characters" && openFolders[f.id] && (
                  <div style={{ padding: "4px 12px 6px 28px" }}>
                    <button
                      onClick={manualScanCharacters}
                      disabled={charLoading}
                      className="action-btn"
                      style={{
                        background: "none",
                        border: "1px dashed #bbb",
                        color: charLoading ? "#bbb" : "#888",
                        cursor: charLoading ? "not-allowed" : "pointer",
                        fontSize: 10,
                        padding: "4px 8px",
                        width: "100%",
                        textAlign: "left",
                        fontFamily: "'Special Elite','Courier New',monospace",
                        letterSpacing: .5,
                        transition: "all .1s",
                      }}
                      title="Scan all chapters for character names and auto-create entries"
                    >
                      {charLoading
                        ? <span className="pulsing">⏳ scanning chapters...</span>
                        : "⟳ scan chapters for names"}
                    </button>
                  </div>
                )}

                {/* Doc list */}
                {openFolders[f.id] && filteredDocs(f.id).map(d => (
                  <div key={d.id} className="doc-row" style={S.docItem(d.id === activeDoc)}
                    onClick={() => setActiveDoc(d.id)}>
                    {renaming === d.id ? (
                      <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") renameDoc(d.id); if (e.key === "Escape") setRenaming(null); }}
                        onClick={e => e.stopPropagation()} style={{ ...S.inputBox, fontSize: 12, padding: "2px 6px" }} />
                    ) : (
                      <span style={S.docTitle(d.id === activeDoc)} onDoubleClick={() => { setRenaming(d.id); setRenameVal(d.title); }}>
                        {d.title}
                        {d.autoCreated && <span style={{ fontSize: 8, color: "#aaa", marginLeft: 5, border: "1px solid #ddd", padding: "0 3px", letterSpacing: .5, verticalAlign: "middle" }}>auto</span>}
                      </span>
                    )}
                    {d.id === activeDoc && (
                      <button className="icon-btn" onClick={e => { e.stopPropagation(); deleteDoc(d.id); }}
                        style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 11 }} title="Delete">×</button>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {/* New folder */}
            {showNewFolder ? (
              <div style={{ padding: "8px 12px", display: "flex", gap: 4 }}>
                <input autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
                  placeholder="Folder name…" style={{ ...S.inputBox, fontSize: 12, padding: "4px 8px" }} />
                <button onClick={createFolder} style={{ ...S.btn(), fontSize: 11, padding: "4px 8px" }}>✓</button>
              </div>
            ) : (
              <button onClick={() => setShowNewFolder(true)} style={{ width: "100%", background: "none", border: "none", color: "#aaa", cursor: "pointer", padding: "10px 12px", textAlign: "left", fontSize: 12, transition: "color .1s", fontFamily: "'Special Elite', 'Courier New', monospace", letterSpacing: .5 }}
                onMouseEnter={e => e.target.style.color = "#111"} onMouseLeave={e => e.target.style.color = "#aaa"}>
                + New Folder
              </button>
            )}
          </div>

          {/* Bottom actions */}
          <div style={{ padding: "12px", borderTop: "1px solid #2a2010", display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", letterSpacing: .8, marginBottom: 2 }}>Export Current Document</div>
            <button onClick={exportDocx} className="action-btn" style={{ ...S.btn("#111"), width: "100%", textAlign: "left" }}>⬇ Export as .docx</button>
            <button onClick={exportPdf} className="action-btn" style={{ ...S.btn("#555"), width: "100%", textAlign: "left" }}>⬇ Export as .pdf</button>
            <button onClick={saveLocal} className="action-btn" style={{ ...S.btn("#888"), width: "100%", textAlign: "left" }}>⬇ Export as .html</button>
            <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", letterSpacing: .8, marginTop: 4, marginBottom: 2 }}>Project Backup</div>
            <button onClick={saveAllLocal} className="action-btn" style={{ ...S.btn("#555"), width: "100%", textAlign: "left" }}>⬇ Backup All (.json)</button>
            <label style={{ ...S.btn("#555"), width: "100%", textAlign: "left", cursor: "pointer", display: "block" }}>
              ⬆ Import Backup
              <input type="file" accept=".json" onChange={importBackup} style={{ display: "none" }} />
            </label>
          </div>
        </div>

        {/* Sidebar resizer */}
        <div style={S.resizer} onMouseDown={startSidebarResize}
          onMouseEnter={e => e.target.style.background = "#bbb"}
          onMouseLeave={e => e.target.style.background = "transparent"} />

        {/* ── MAIN EDITOR ── */}
        <div style={S.main}>
          {/* Toolbar */}
          <div style={S.toolbar}>
            <TB cmd="bold"          title="Bold (Ctrl+B)"><b>B</b></TB>
            <TB cmd="italic"        title="Italic (Ctrl+I)"><i>I</i></TB>
            <TB cmd="underline"     title="Underline (Ctrl+U)"><u>U</u></TB>
            <TB cmd="strikeThrough" title="Strikethrough"><s>S</s></TB>
            <div style={S.sep} />
            <TB cmd="formatBlock" arg="h1" title="Heading 1">H1</TB>
            <TB cmd="formatBlock" arg="h2" title="Heading 2">H2</TB>
            <TB cmd="formatBlock" arg="h3" title="Heading 3">H3</TB>
            <TB cmd="formatBlock" arg="p"  title="Paragraph">¶</TB>
            <TB cmd="formatBlock" arg="blockquote" title="Blockquote">❝</TB>
            <div style={S.sep} />
            <TB cmd="insertUnorderedList" title="Bullet list">• —</TB>
            <TB cmd="insertOrderedList"   title="Numbered list">1.</TB>
            <div style={S.sep} />
            <TB cmd="justifyLeft"    title="Align left">⬅</TB>
            <TB cmd="justifyCenter"  title="Center">↔</TB>
            <TB cmd="justifyRight"   title="Align right">➡</TB>
            <div style={S.sep} />
            <TB cmd="undo" title="Undo">↩</TB>
            <TB cmd="redo" title="Redo">↪</TB>
            <div style={S.sep} />
            <select onChange={e => document.execCommand("fontSize", false, e.target.value)} defaultValue="3"
              style={{ background: "#fff", border: "1px solid #bbb", color: "#333", borderRadius: 0, padding: "3px 6px", fontSize: 11, cursor: "pointer", fontFamily: "'Special Elite', 'Courier New', monospace" }}>
              {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{[10,12,14,16,18,24,32][n-1]}px</option>)}
            </select>
<select onMouseDown={e => e.stopPropagation()} onChange={e => { e.preventDefault(); document.execCommand("fontName", false, e.target.value); }}
  style={{ background: "#fff", border: "1px solid #bbb", color: "#333", borderRadius: 0, padding: "3px 6px", fontSize: 11, cursor: "pointer", fontFamily: "'Special Elite', 'Courier New', monospace", marginLeft: 4 }}>
  <option value="">Font…</option>
  <option value="Special Elite, Courier New, monospace">Special Elite</option>
  <option value="Georgia, serif">Georgia</option>
  <option value="Palatino, serif">Palatino</option>
  <option value="Times New Roman, serif">Times New Roman</option>
  <option value="Courier New, monospace">Courier New</option>
  <option value="Arial, sans-serif">Arial</option>
  <option value="Verdana, sans-serif">Verdana</option>
  <option value="Garamond, serif">Garamond</option>
</select>
            <div style={{ flex: 1 }} />
            {doc?.folderId === "chapters" && (
              <button onClick={manualResearch} disabled={researchLoading}
                title={selectedText ? `Research selected text: "${selectedText.slice(0,40)}…"` : "Research entire chapter"}
                style={{ ...S.btn(selectedText ? "#000" : "#333"), display: "flex", alignItems: "center", gap: 5, fontWeight: selectedText ? "bold" : "normal", borderStyle: selectedText ? "solid" : "solid", background: selectedText ? "rgba(0,0,0,0.07)" : "transparent" }}>
                {researchLoading ? <span className="pulsing">🔭</span> : "🔭"}
                {selectedText ? " Research Selection" : " Research"}
              </button>
            )}
            <button onClick={() => setShowRight(p => !p)} style={{ ...S.btn("#555"), marginLeft: 4 }}>{showRight ? "◀ Hide" : "▶ Show"} Panel</button>
          </div>

          {/* Doc title bar */}
          {doc && (
            <div style={{ padding: "8px 72px 6px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #ddd", background: "#f8f5f0" }}>
              <span style={{ fontSize: 10, color: "#888", letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'Special Elite','Courier New',monospace" }}>{folder?.icon} {folder?.name}</span>
              <span style={{ color: "#ccc" }}>›</span>
              {renaming === doc.id ? (
                <input value={renameVal} onChange={e => setRenameVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") renameDoc(doc.id); if (e.key === "Escape") setRenaming(null); }}
                  style={{ ...S.inputBox, fontSize: 15, padding: "2px 6px", flex: 1 }} autoFocus />
              ) : (
                <span style={{ fontSize: 15, color: "#111", fontFamily: "'Special Elite','Courier New',monospace", cursor: "default", letterSpacing: .5 }}
                  onDoubleClick={() => { setRenaming(doc.id); setRenameVal(doc.title); }}>{doc.title}</span>
              )}
            </div>
          )}

          {/* Editor area */}
          <div className="editor-wrap" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f8f5f0" }}>
          <div
            ref={editorRef}
            contentEditable={doc ? true : false}
            suppressContentEditableWarning
            onInput={onEditorInput}
            onMouseUp={onSelectionChange}
            onKeyUp={onSelectionChange}
            data-placeholder="Begin writing..."
            style={{ ...S.editor, ...(doc?.folderId === "ai-research" ? { color: "#111" } : {}) }}
          />
          </div>

          {/* Status bar */}
          <div style={S.statusBar}>
            <span style={{ color: saveStatus === "saved" ? "#4a8a4a" : "#888" }}>
              {saveStatus === "saved" ? "✓ Saved" : "⏳ " + saveStatus}
            </span>
            <span>{wordCount.toLocaleString()} words</span>
            {doc && <span>Last edited {fmt(doc.updatedAt)}</span>}
            <span style={{ flex: 1 }} />
            <span>Double-click title to rename • Ctrl+B/I/U for formatting</span>
          </div>
        </div>

        {/* Right panel resizer */}
        {showRight && <div style={S.resizer} onMouseDown={startRightResize}
          onMouseEnter={e => e.target.style.background = "#bbb"}
          onMouseLeave={e => e.target.style.background = "transparent"} />}

        {/* ── RIGHT PANEL ── */}
        {showRight && (
          <div style={S.rightPanel}>
            <div style={S.rightHeader}>
              <span style={{ fontSize: 11, fontWeight: 400, letterSpacing: 1.5, textTransform: "uppercase", color: "#555", fontFamily: "'Special Elite','Courier New',monospace" }}>🔭 AI Research</span>
              {researchLoading && <span className="pulsing" style={{ fontSize: 11, color: "#888" }}>Analyzing...</span>}
            </div>
            <div style={S.rightContent}>
              {aiDocs.length === 0 ? (
                <div style={{ color: "#aaa", fontSize: 12, textAlign: "center", marginTop: 32, lineHeight: 1.8, fontFamily: "'Special Elite','Courier New',monospace" }}>
                  <div style={{ fontSize: 26, marginBottom: 12 }}>🔭</div>
                  Write at least 20 words in any chapter document and research suggestions will appear here automatically after a few seconds.
                </div>
              ) : (
                aiDocs.map(d => (
                  <div key={d.id} className="ai-doc" style={S.aiDocItem} onClick={() => setActiveDoc(d.id)}>
                    <div style={{ fontSize: 11, color: "#222", marginBottom: 4, fontFamily: "'Special Elite','Courier New',monospace" }}>{d.title}</div>
                    <div style={{ fontSize: 10, color: "#aaa", fontFamily: "'Special Elite','Courier New',monospace" }}>{fmt(d.updatedAt)}</div>
                  </div>
                ))
              )}

              {/* Generate more button — visible when on a chapter doc */}
              {doc?.folderId === "chapters" && (
                <button
                  onClick={manualResearch}
                  disabled={researchLoading}
                  className="action-btn"
                  style={{
                    ...S.btn("#333"),
                    width: "100%",
                    marginTop: 12,
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    opacity: researchLoading ? 0.5 : 1,
                    cursor: researchLoading ? "not-allowed" : "pointer",
                    borderStyle: "dashed",
                    background: selectedText ? "rgba(0,0,0,0.05)" : "transparent",
                    fontWeight: selectedText ? "bold" : "normal",
                  }}
                  title={selectedText ? `Research selected: "${selectedText.slice(0,50)}…"` : "Research entire chapter"}
                >
                  {researchLoading
                    ? <><span className="pulsing">⏳</span> Generating...</>
                    : selectedText
                      ? <>✂️ Research Selection</>
                      : <>+ Generate More Suggestions</>}
                </button>
              )}
              <div style={{ marginTop: 20, borderTop: "1px solid #ccc", paddingTop: 16 }}>
                <div style={{ fontSize: 10, color: "#aaa", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'Special Elite','Courier New',monospace" }}>Document Stats</div>
                {folders.filter(f => f.id !== "ai-research").map(f => {
                  const count = docs.filter(d => d.folderId === f.id).length;
                  const wc = docs.filter(d => d.folderId === f.id).reduce((a, d) => a + (d.wordCount || 0), 0);
                  return (
                    <div key={f.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #e8e4de", fontSize: 11, fontFamily: "'Special Elite','Courier New',monospace" }}>
                      <span style={{ color: "#333" }}>{f.icon} {f.name}</span>
                      <span style={{ color: "#999" }}>{count} · {wc.toLocaleString()}w</span>
                    </div>
                  );
                })}
                <div style={{ marginTop: 12, padding: "8px 10px", background: "rgba(0,0,0,0.04)", borderRadius: 0, fontSize: 11, border: "1px solid #ddd", fontFamily: "'Special Elite','Courier New',monospace" }}>
                  <div style={{ color: "#333", marginBottom: 4, letterSpacing: .5 }}>Total Project</div>
                  <div style={{ color: "#666" }}>{docs.filter(d => d.folderId !== "ai-research").length} documents</div>
                  <div style={{ color: "#666" }}>{docs.filter(d => d.folderId !== "ai-research").reduce((a, d) => a + (d.wordCount || 0), 0).toLocaleString()} words</div>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* ── CONFIRM MODAL ── */}
        {confirmModal && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => setConfirmModal(null)}>
            <div style={{ background: "#fff", border: "2px solid #333", padding: "24px 28px", fontFamily: "'Special Elite','Courier New',monospace", minWidth: 280, boxShadow: "4px 4px 0 #333" }}
              onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 14, color: "#111", marginBottom: 20, lineHeight: 1.5 }}>{confirmModal.message}</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setConfirmModal(null)}
                  style={{ background: "none", border: "1px solid #bbb", padding: "6px 16px", cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: "#555" }}>
                  Cancel
                </button>
                <button onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }}
                  style={{ background: "#111", border: "1px solid #111", color: "#fff", padding: "6px 16px", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
