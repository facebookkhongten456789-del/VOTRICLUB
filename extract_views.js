const fs = require('fs');
const path = require('path');

const indexHtmlPath = path.join(__dirname, 'index.html');
const viewsDir = path.join(__dirname, 'views');

if (!fs.existsSync(viewsDir)) {
    fs.mkdirSync(viewsDir);
}

let html = fs.readFileSync(indexHtmlPath, 'utf8');

// Regex to match <div class="view-container"... id="xyz"> ... </div>
// Since regex can't easily match balanced HTML tags, we'll parse it manually.

const viewRegex = /<div[^>]*class="[^"]*view-container[^"]*"[^>]*id="([^"]+)"[^>]*>/g;

let match;
const viewsFound = [];

while ((match = viewRegex.exec(html)) !== null) {
    const startIdx = match.index;
    const viewId = match[1];
    
    // Find matching closing div
    let openDivs = 0;
    let endIdx = -1;
    
    // Start searching from the `<div` we just matched
    const substr = html.substring(startIdx);
    
    // We iterate over tags
    const tagRegex = /<\/?div[^>]*>/g;
    let tagMatch;
    
    while ((tagMatch = tagRegex.exec(substr)) !== null) {
        if (tagMatch[0].startsWith('<div')) {
            openDivs++;
        } else if (tagMatch[0].startsWith('</div')) {
            openDivs--;
            if (openDivs === 0) {
                endIdx = startIdx + tagMatch.index + tagMatch[0].length;
                break;
            }
        }
    }
    
    if (endIdx !== -1) {
        viewsFound.push({
            id: viewId,
            start: startIdx,
            end: endIdx,
            content: html.substring(startIdx, endIdx)
        });
    }
}

// Sort in reverse order to replace from bottom to top so indices don't shift
viewsFound.sort((a, b) => b.start - a.start);

for (const view of viewsFound) {
    const fileName = `${view.id}.html`;
    const filePath = path.join(viewsDir, fileName);
    
    // Write content to views/view-xyz.html
    fs.writeFileSync(filePath, view.content, 'utf8');
    
    // Replace in main html
    const includeStr = `<!-- INCLUDE views/${fileName} -->`;
    html = html.substring(0, view.start) + includeStr + html.substring(view.end);
    console.log(`Extracted ${fileName}`);
}

fs.writeFileSync(indexHtmlPath, html, 'utf8');
console.log('Successfully extracted ' + viewsFound.length + ' views.');
