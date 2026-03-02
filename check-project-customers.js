const p = require('./public/projects-backup.json');

const projectNameMap = {};

p.forEach(proj => {
  const name = proj.projectName;
  const customer = proj.customer;
  
  if (!name) return;
  
  if (!projectNameMap[name]) {
    projectNameMap[name] = new Set();
  }
  
  if (customer) {
    projectNameMap[name].add(customer);
  }
});

const multipleCustomers = [];

Object.entries(projectNameMap).forEach(([name, customers]) => {
  if (customers.size > 1) {
    multipleCustomers.push({
      projectName: name,
      customerCount: customers.size,
      customers: Array.from(customers)
    });
  }
});

multipleCustomers.sort((a, b) => b.customerCount - a.customerCount);

console.log(`Project Names with Multiple Customers: ${multipleCustomers.length}\n`);

multipleCustomers.forEach(item => {
  console.log(`\n${item.projectName}`);
  console.log(`  ${item.customerCount} customers:`);
  item.customers.forEach(c => console.log(`    - ${c}`));
});

if (multipleCustomers.length === 0) {
  console.log('No project names have multiple customers.');
}
