declare module 'imap-simple' {
  export interface ImapSimpleOptions {
    imap: {
      user: string;
      password: string;
      host: string;
      port: number;
      tls: boolean;
      authTimeout?: number;
      tlsOptions?: {
        rejectUnauthorized: boolean;
      };
    };
  }

  export interface MessagePart {
    which: string;
    size: number;
    body: any;
  }

  export interface Message {
    attributes: {
      uid: string | number;
      flags: string[];
      date: Date;
      [key: string]: any;
    };
    parts: MessagePart[];
  }

  export interface Connection {
    openBox(mailboxName: string): Promise<any>;
    search(searchCriteria: any[], fetchOptions: any): Promise<Message[]>;
    end(): Promise<void>;
  }

  export function connect(options: ImapSimpleOptions): Promise<Connection>;
  export function parseHeader(header: string): { [key: string]: string[] };

  const ImapSimple: {
    connect: typeof connect;
    parseHeader: typeof parseHeader;
  };

  export default ImapSimple;
} 