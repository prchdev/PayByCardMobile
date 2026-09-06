export type RootStackParamList = {
  Home: undefined;
  Login: undefined;
  Register: undefined;
  VerifyOTP: { userId: string; email: string; mobileNumber: string; fromLogin: boolean } | undefined;
  ForgotPassword: undefined;
  Dashboard: { userId: string; userEmail: string } | undefined;
  MakePayment: { userId: string; userEmail: string } | undefined;
  MyTransactions: { userId: string; userEmail: string } | undefined;
  MyBeneficiaries: { userId: string; userEmail: string } | undefined;
  MyBankAccounts: { userId: string; userEmail: string } | undefined;
  KYCVerification: { userId: string; userEmail: string } | undefined;
  HelpSupport: { userId: string; userEmail: string } | undefined;
  ChangePassword: { userId: string; userEmail: string } | undefined;
  More: { userId: string; userEmail: string } | undefined;
  Notifications: { userId: string; userEmail: string } | undefined;
};
