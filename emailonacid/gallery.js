const fs = require('fs');
const config = require('../emailonacid/clients.json');

const clients = fs.readFileSync('clients.txt', 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

const clientsMap = config.clients;

const allClients = clients.map(clientId =>
    clientsMap[clientId]);

const sortedClients = allClients.sort((a, b) =>
    a.client.localeCompare(b.client));

const htmlContent = fs.readFileSync('../output/index.html', 'utf-8');

const { figureHtml, figureAttr, figureLead } =
    /(?<figureLead>\s*)<figure(?<figureAttr>[^>]*)>(?<figureHtml>.*?)<\/figure>/s
        .exec(htmlContent).groups;

const clientsHtml = sortedClients.map(({ id, client, os, category, browser }) => {

    const img = `${id}.png`;

    const title = [os, category, browser]
        .filter(x => x)
        .join(' / ');

    const transformedFigureHtml = figureHtml
        .replace(/(href|src)="[^"]*"/sg, `$1="${img}"`)
        .replace(/alt="[^"]*"/sg, `alt="${title}"`)
        .replace(
            /(<(?<element>h2[^>]*)>)(.*?)(<\/(\k<element>)>)/gs,
            `<$<element>>${client}</$<element>>`)
        .replace(
            /(<(?<element>figcaption[^>]*)>)(.*?)(<\/(\k<element>)>)/gs,
            `<$<element>>${title}</$<element>>`);

    return `${figureLead}<figure${figureAttr}>${transformedFigureHtml}</figure>`;
})
.join('');

const updatedHtmlContent = htmlContent.replace(
    /\s*<figure[^>]*>.*<\/figure>/s,
    clientsHtml);

fs.writeFileSync('../output/index.html', updatedHtmlContent);
