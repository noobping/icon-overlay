const fileA = document.getElementById("fileA");
const layerA = document.getElementById("layerA");
const layerB = document.getElementById("layerB");
const svgText = document.getElementById("svgText");
const applyBtn = document.getElementById("applyBtn");
const formatBtn = document.getElementById("formatBtn");

async function loadGridSvg(url = "./grid.svg") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
    return await res.text();
}

function toSvgElement(svgXml) {
    const doc = new DOMParser().parseFromString(svgXml, "image/svg+xml");
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== "svg") throw new Error("Geen geldige SVG (geen <svg> root).");

    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    return svg;
}

function ensureViewBox(svg) {
    if (svg.getAttribute("viewBox")) return;
    const old = svg.style.visibility;
    svg.style.visibility = "hidden";
    try {
        const b = svg.getBBox();
        svg.setAttribute("viewBox", `${b.x || 0} ${b.y || 0} ${Math.max(b.width, 1)} ${Math.max(b.height, 1)}`);
    } catch {
        svg.setAttribute("viewBox", "0 0 100 100");
    } finally {
        svg.style.visibility = old;
    }
}

function renderLayer1FromText(text) {
    const svg = toSvgElement(text);

    // Put into DOM first, then ensureViewBox
    layerA.replaceChildren(svg);
    ensureViewBox(svg);
    enableSimpleSvgEditing(svg);
    console.log("Rendered");
}

function enableSimpleSvgEditing(svgRoot) {
    let selected = null;
    let dragging = false;

    function getState(el) {
        const t = el.getAttribute("transform") || "";
        const m = t.match(/translate\(([-\d.]+)[ ,]([-\d.]+)\)/);
        const s = t.match(/scale\(([-\d.]+)\)/);
        return {
            tx: m ? parseFloat(m[1]) : 0,
            ty: m ? parseFloat(m[2]) : 0,
            sc: s ? parseFloat(s[1]) : 1
        };
    }

    function setState(el, tx, ty, sc) {
        el.setAttribute("transform", `translate(${tx} ${ty}) scale(${sc})`);
    }

    function getSvgScale(svg) {
        // Convert screen px -> SVG units using CTM.
        // Use absolute values to avoid mirrored axes.
        const ctm = svg.getScreenCTM();
        if (!ctm) return { sx: 1, sy: 1 };
        return { sx: Math.abs(ctm.a) || 1, sy: Math.abs(ctm.d) || 1 };
    }

    svgRoot.addEventListener("pointerdown", (e) => {
        const el = e.target.closest("path, rect, circle, ellipse, polygon, polyline, line, g");
        if (!el || el === svgRoot) return;

        selected = el;
        dragging = true;

        svgRoot.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    svgRoot.addEventListener("pointermove", (e) => {
        if (!dragging || !selected) return;

        const st = getState(selected);
        const { sx, sy } = getSvgScale(svgRoot);

        // movementX/Y are in screen pixels; convert to SVG units
        const dx = e.movementX / sx;
        const dy = e.movementY / sy;

        setState(selected, st.tx + dx, st.ty + dy, st.sc);
    });

    function stopDrag() {
        if (dragging && selected) {
            syncSvgToEditor(svgRoot);
        }
        dragging = false;
    }

    svgRoot.addEventListener("pointerup", stopDrag);
    svgRoot.addEventListener("pointercancel", stopDrag);
    svgRoot.addEventListener("lostpointercapture", stopDrag);

    svgRoot.addEventListener("wheel", (e) => {
        if (!selected) return;
        e.preventDefault();

        const st = getState(selected);
        const factor = e.deltaY < 0 ? 1.05 : 0.95;
        const next = Math.min(20, Math.max(0.05, st.sc * factor));
        setState(selected, st.tx, st.ty, next);
        syncSvgToEditor(svgRoot);
    }, { passive: false });
}

let syncTimer = null;
function syncSvgToEditor(svgRoot) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        const serializer = new XMLSerializer();
        svgText.textContent = serializer.serializeToString(svgRoot);
    }, 150);
}

// Very basic formatter for XML
function formatXml(xml) {
    const P = "  ";
    xml = xml.replace(/>\s+</g, "><");
    let pad = 0;
    return xml
        .replace(/</g, "\n<")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(line => {
            const isClosing = /^<\/.+>/.test(line);
            const isOpening = /^<[^!?/].*[^/]>$/.test(line);
            const isSelfClosing = /^<.*\/>$/.test(line);

            if (isClosing) pad = Math.max(pad - 1, 0);
            const out = P.repeat(pad) + line.trim();
            if (isOpening && !isSelfClosing) pad += 1;
            return out;
        })
        .join("\n")
        .trim();
}

// Debounce typing -> rerender
let t = null;
function scheduleRender() {
    clearTimeout(t);
    t = setTimeout(() => {
        const txt = svgText.textContent.trim();
        if (!txt) return;
        try {
            renderLayer1FromText(txt);
        } catch (e) {
            console.error("Rerender error", (e?.message || e));
        }
    }, 250);
}

// Init grid
(async function initGrid() {
    try {
        const gridXml = await loadGridSvg("grid.svg");
        const grid = toSvgElement(gridXml);

        layerB.replaceChildren(grid);

        // keep your currentColor behavior
        grid.querySelectorAll("[stroke], [style*='stroke:']").forEach(el =>
            el.setAttribute("stroke", "currentColor")
        );
    } catch (e) {
        console.error("Grid error", (e?.message || e));
    }
})();

// Upload -> put file contents into textarea + render
fileA.addEventListener("change", async () => {
    const f = fileA.files?.[0];
    if (!f) return;

    const txt = await f.text();
    svgText.textContent = txt;

    try {
        renderLayer1FromText(txt);
    } catch (e) {
        console.error("Change event error", (e?.message || e));
    }
});

// Typing edits
svgText.addEventListener("input", scheduleRender);

// Manual apply
applyBtn.addEventListener("click", () => {
    try {
        renderLayer1FromText(svgText.textContent.trim());
    } catch (e) {
        console.error("Click event error", (e?.message || e));
    }
});

formatBtn.addEventListener("click", () => {
    svgText.textContent = formatXml(svgText.textContent);
    scheduleRender();
});