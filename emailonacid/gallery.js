const fs = require('fs');
const config = require('../emailonacid/clients.json');

const clientGroups = [
    'AOL.com',
    'Apple Mail',
    'Free.fr',
    'Gmail',
    'GMX',
    'iPhone',
    'Libero',
    'Microsoft365',
    'Outlook',
    'T-Online',
    'Web.de',
    'Yahoo.com',
];

const osGroups = [
    'iOS',
    'macOS',
    'Windows',
    'Android',
];

const categories = [
    'Webmail',
    'Desktop',
    'Mobile',
];

const brands = {
    'client-apple-mail': 'fa-apple',
    'client-iphone': 'fa-apple',
    'client-gmail': 'fa-google',
    'client-yahoo-com': 'fa-yahoo',
    'client-outlook': 'fa-windows',
    'client-microsoft365': 'fa-windows',
};

function getClasses(prefix, groups, groupName) {
    const group = groups.find(group => groupName.startsWith(group));

    if (!group) {
        return [];
    }

    return [`${prefix}-${group.toLocaleLowerCase().replace(/(\s|\.)+/g, '-')}`];
}

function getFigureClasses(client, os, category) {

    return [
        ...getClasses('client', clientGroups, client),
        ...getClasses('os', osGroups, os),
        ...getClasses('category', categories, category)
    ];
}

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

    const figureClasses = getFigureClasses(client, os, category).join(' ');

    let iconClass = ''
    for (const [key, value] of Object.entries(brands)) {
        if (figureClasses.includes(key)) {
            iconClass = value;
            break;
        }
    }

    const title = [os, category, browser]
        .filter(x => x)
        .join('');

    const htmlTitle = '<span>' + [os, category, browser]
        .filter(x => x)
        .join('</span><span>') + '</span>';

    const transformedFigureHtml = figureHtml
        .replace(/(href|src)="[^"]*"/sg, `$1="${img}"`)
        .replace(/alt="[^"]*"/sg, `alt="${title}"`)
        .replace(
            /<h2(?<attr>[^>]*)>(.*?)<\/h2>/gs,
            `<h2$<attr>><i class="icon brands ${iconClass}"></i><br />${client}</h2>`)
        .replace(
            /<figcaption(?<attr>[^>]*)>(.*?)<\/figcaption>/gs,
            `<figcaption$<attr>>${htmlTitle}</figcaption>`);

    const figureAttrUpdated = figureAttr.replace(
        /\s*class="([^"]*)"/,
        ` class="${figureClasses}"`);

    return `${figureLead}<figure${figureAttrUpdated}>${transformedFigureHtml}</figure>`;
})
.join('');

const updatedHtmlContent = htmlContent.replace(
    /\s*<figure[^>]*>.*<\/figure>/s,
    clientsHtml);

fs.writeFileSync('../output/index.html', updatedHtmlContent);
