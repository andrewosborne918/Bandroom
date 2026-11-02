import {billingWebhook} from '../../../../lib/cloud/billing';
export const runtime='nodejs';
export const POST=(req:Request)=>billingWebhook(req);
