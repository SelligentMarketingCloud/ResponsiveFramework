const fs = require('fs');
const config = require('../emailonacid/clients.json');

const clients = fs.readFileSync('clients.txt', 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

const clientsMap = config.clients;

const allClients = clients.map(clientId =>
    clientsMap[clientId]);

const groupedClients = allClients.reduce((acc, diff) => {
    const clientName = diff.client;

    if (acc[clientName]) {
        return {...acc, [clientName]: [...acc[clientName], diff]};
    }

    return {...acc, [clientName]: [diff]};
}, {});

const sortedGroupedClients = Object.values(groupedClients).sort((a, b) =>
    a[0].client.localeCompare(b[0].client));

const htmlContent = fs.readFileSync('../output/index.html', 'utf-8');

const { articleHtml, articleAttr, articleLead } =
    /(?<articleLead>\s*)<article(?<articleAttr>[^>]*)>(?<articleHtml>.*?)<\/article>/s
        .exec(htmlContent).groups;

const clientsHtml = sortedGroupedClients.map(group => {

    const { figureHtml, figureAttr, figureLead } =
        /(?<figureLead>\s*)<figure(?<figureAttr>[^>]*)>(?<figureHtml>.*?)<\/figure>/s
            .exec(articleHtml).groups;

    const clientName = group[0].client;

    const clientsString = group.map(({ id, os, category, browser }) => {

        const img = `${id}.png`;

        const title = [os, category, browser]
            .filter(x => x)
            .join(' / ');

        const figureWithImg = figureHtml
            .replace(/(href|src)="[^"]*"/sg, `$1="${img}"`);

        const figureWithAltImg = figureWithImg
            .replace(/alt="[^"]*"/sg, `alt="${title}"`);

        const figureWithAltImageAndCaption = figureWithAltImg
            .replace(
                /(<figcaption[^>]*>)(.*)(<\/figcaption>)/,
                `$1${title}$3`);

        return `${figureLead}<figure${figureAttr}>${figureWithAltImageAndCaption}</figure>`;
    })
    .join('');

    const articleWithTitle = articleHtml.replace(
        /(<h2[^>]*>)(.*?)(<\/h2>)/,
        `$1${clientName}$3`);

    const articleWithContent = articleWithTitle
        .replace(/\s*<figure[^>]*>.*<\/figure>/s,
            clientsString);

    return `${articleLead}<article${articleAttr}>${articleWithContent}</article>`;
})
.join('');

const updatedHtmlContent = htmlContent.replace(
    /\s*<article[^>]*>.*<\/article>/s,
    clientsHtml);

fs.writeFileSync('../output/index.html', updatedHtmlContent);
