interface HeaderProps {
  name: string;
  admin?: boolean;
  onLogout: () => void;
}

export function Header({ name, admin, onLogout }: HeaderProps) {
  return (
    <header className="site-header">
      <div className="brand-mark" aria-hidden="true">CH</div>
      <div className="brand-copy">
        <p>{admin ? 'Household administration' : 'The Carter home'}</p>
        <h1>House Ledger</h1>
      </div>
      <div className="header-account">
        <span>{name}</span>
        <button className="text-button" onClick={onLogout}>Sign out</button>
      </div>
    </header>
  );
}
