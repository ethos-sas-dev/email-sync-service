// Esta declaración amplía los tipos existentes para resolver el problema con AddressObject
import { AddressObject } from 'mailparser';

declare module 'mailparser' {
  interface AddressObject {
    value: { address: string; name: string }[];
    html: string;
    text: string;
    address?: string;
    name?: string;
  }
} 