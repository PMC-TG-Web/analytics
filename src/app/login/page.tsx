import { procoreSignInEnabled } from '@/lib/appSignInPolicy';
import LegacyLogin from './LegacyLogin';
import ProcoreLogin from './ProcoreLogin';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return procoreSignInEnabled()
    ? <ProcoreLogin allowEmail={process.env.AUTH0_EMAIL_LOGIN_ENABLED !== 'false'} />
    : <LegacyLogin />;
}
