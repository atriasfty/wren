import { Polar } from '@polar-sh/sdk';

const p = new Polar();

console.log('--- Checkouts ---');
console.log(p.checkouts ? Object.keys(p.checkouts) : 'no checkouts');

console.log('--- Customer Sessions ---');
console.log(p.customerSessions ? Object.keys(p.customerSessions) : 'no customerSessions');

console.log('--- Subscriptions ---');
console.log(p.subscriptions ? Object.keys(p.subscriptions) : 'no subscriptions');
