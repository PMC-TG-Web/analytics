import fs from 'fs';

const data = JSON.parse(fs.readFileSync('rest_OAS_all_postman.json', 'utf8'));

function findItemsByKeyword(items, keyword, results = []) {
  for (const item of items) {
    if (item.name && item.name.toLowerCase().includes(keyword.toLowerCase())) {
      results.push(item);
    }
    if (item.item) {
      findItemsByKeyword(item.item, keyword, results);
    }
  }
  return results;
}

const productivityItems = findItemsByKeyword(data.item, 'Productivity Log');

productivityItems.forEach(item => {
  console.log(`--- Name: ${item.name} ---`);
  if (item.request) {
    console.log(`Method: ${item.request.method}`);
    console.log(`URL: ${item.request.url.path.join('/')}`);
    if (item.request.body && item.request.body.raw) {
      console.log('Body:');
      console.log(item.request.body.raw);
    }
  }
  console.log('\n');
});
