import { Polar } from '@polar-sh/sdk';
type CC = Parameters<Polar['checkouts']['create']>[0];
let c: CC;
// I'll intentionally cause a type error that prints the whole type
c = 1;
