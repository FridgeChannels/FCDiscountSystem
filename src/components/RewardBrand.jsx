import { createContext, useContext, useState } from 'react';

export const RewardBrandContext = createContext({});

export function RewardBrandMark() {
  const { wordmark, logo, name } = useContext(RewardBrandContext);
  const [failed, setFailed] = useState([]);
  const source = [wordmark, logo].find(url => url && !failed.includes(url));
  return source
    ? <img className="reward-brand-mark" src={source} alt={name || 'Brand'} onError={() => setFailed(previous => [...previous, source])} />
    : <strong className="reward-brand-name">{name || 'FridgeChannel'}</strong>;
}
