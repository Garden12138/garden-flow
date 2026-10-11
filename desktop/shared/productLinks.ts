export type ProductLink = {
    id: string;
    productIds: [string, string];
    confirmedAt: string;
    reason: string;
};

export type ProductLinkCandidate = {
    productId: string;
    productVersion: string;
    name: string;
    platform?: string;
    reason: string;
};

export type LinkProductsInput = {
    productId: string;
    relatedProductId: string;
    productVersion: string;
    relatedProductVersion: string;
    reason?: string;
};
