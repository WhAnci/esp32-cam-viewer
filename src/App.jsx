import React, { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw,
  Download,
  Trash2,
  Calendar,
  Clock,
  AlertTriangle,
  Shield,
  Settings,
  Zap,
} from 'lucide-react';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// 파일 크기 포맷팅
const formatFileSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

// 타임스탬프 포맷팅
const formatTimestamp = (timestamp) => {
  return timestamp.toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// 로딩 오버레이
function FullScreenLoading({ message = '데이터 확인 중...' }) {
  return (
    <div className="fixed inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center z-[9999]">
      <div className="text-center px-6">
        <RefreshCw className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-3" />
        <p className="text-gray-700 font-semibold">{message}</p>
      </div>
    </div>
  );
}

export default function S3ImageViewer() {
  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [sortBy, setSortBy] = useState('newest');
  const [filterDate, setFilterDate] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [error, setError] = useState(null);
  const [refreshIntervalSec, setRefreshIntervalSec] = useState(30);
  const [stats, setStats] = useState({ lastHour: 0, today: 0, total: 0 });

  const s3Client = useMemo(() => new S3Client({
    region: import.meta.env.VITE_AWS_REGION,
    credentials: {
      accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID,
      secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY,
    },
  }), []);

  const bucketName = import.meta.env.VITE_AWS_BUCKET_NAME;

  const loadImagesFromS3 = async () => {
    try {
      let allItems = [];
      let ContinuationToken;
      do {
        const command = new ListObjectsV2Command({ Bucket: bucketName, ContinuationToken });
        const response = await s3Client.send(command);
        if (response.Contents) allItems.push(...response.Contents);
        ContinuationToken = response.NextContinuationToken;
      } while (ContinuationToken);

      const imagePromises = allItems
        .filter(item => /\.(jpg|jpeg)$/i.test(item.Key))
        .map(async (item) => {
          const url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucketName, Key: item.Key }), { expiresIn: 3600 });
          return { id: item.Key, key: item.Key, url, name: item.Key.split('/').pop(), timestamp: item.LastModified, size: formatFileSize(item.Size) };
        });

      const imageList = await Promise.all(imagePromises);
      imageList.sort((a, b) => b.timestamp - a.timestamp);
      setImages(imageList);

      const now = Date.now();
      const oneHourAgo = now - 3600000;
      const todayStart = new Date().setHours(0, 0, 0, 0);

      setStats({
        lastHour: imageList.filter(img => img.timestamp.getTime() > oneHourAgo).length,
        today: imageList.filter(img => img.timestamp.getTime() > todayStart).length,
        total: imageList.length,
      });
    } catch (err) {
      setError('데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (img) => {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      setIsLoading(true);
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: img.key }));
      setSelectedImage(null);
      await loadImagesFromS3();
    } catch (e) { alert('삭제 실패'); }
    finally { setIsLoading(false); }
  };

  const deleteAllImages = async () => {
    if (!confirm('모든 사진을 삭제하시겠습니까?')) return;
    try {
      setIsDeletingAll(true);
      setIsLoading(true);
      for (const img of images) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: img.key }));
      }
      await loadImagesFromS3();
    } catch (e) { alert('전체 삭제 실패'); }
    finally { setIsDeletingAll(false); setIsLoading(false); }
  };

  useEffect(() => {
    loadImagesFromS3();
    if (refreshIntervalSec === 0) return;
    const interval = setInterval(() => { if (!isDeletingAll) loadImagesFromS3(); }, refreshIntervalSec * 1000);
    return () => clearInterval(interval);
  }, [refreshIntervalSec, isDeletingAll]);

  const displayImages = useMemo(() => {
    let filtered = [...images];
    const now = Date.now();
    if (filterDate === 'lastHour') filtered = filtered.filter(img => img.timestamp.getTime() > now - 3600000);
    else if (filterDate === 'today') filtered = filtered.filter(img => img.timestamp.getTime() > new Date().setHours(0,0,0,0));
    
    if (sortBy === 'oldest') filtered.sort((a, b) => a.timestamp - b.timestamp);
    else if (sortBy === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));
    return filtered;
  }, [images, filterDate, sortBy]);

  if (isLoading && images.length === 0) return <FullScreenLoading />;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 flex flex-col w-full font-sans">
      {(isLoading || isDeletingAll) && images.length > 0 && <FullScreenLoading message={isDeletingAll ? "삭제 중..." : "새로고침 중..."} />}

      {/* 헤더: 모바일 최적화 */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-40">
        <div className="p-3">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="bg-blue-600 p-1.5 rounded-lg shadow-sm">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-lg font-extrabold text-blue-700 leading-none">공마고</h1>
                  <span className="text-[10px] text-gray-400 font-medium">REFRIGERATOR MONITOR</span>
                </div>
              </div>
              <button onClick={() => loadImagesFromS3()} className="p-2 text-blue-600 active:scale-95 transition-transform">
                <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              <button onClick={deleteAllImages} className="whitespace-nowrap flex items-center gap-1.5 bg-red-50 text-red-600 px-3 py-1.5 rounded-full text-xs font-bold border border-red-100">
                <Trash2 className="w-3.5 h-3.5" /> 사진 전체 삭제
              </button>
              <div className="flex items-center gap-1 bg-gray-100 px-3 py-1.5 rounded-full text-xs font-bold text-gray-600 border border-gray-200">
                <Settings className="w-3.5 h-3.5" />
                <select value={refreshIntervalSec} onChange={(e) => setRefreshIntervalSec(Number(e.target.value))} className="bg-transparent outline-none">
                  <option value={0}>수동</option>
                  <option value={10}>10초</option>
                  <option value={30}>30초</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="p-3 flex-grow">
        {/* 경고문 축소 */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex gap-2 items-start shadow-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-900 leading-snug font-medium">
            비인가 데이터 접근 시 법적 처벌을 받을 수 있습니다.
          </p>
        </div>

        {/* 통계 카드: 슬림형 */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: '최근', val: stats.lastHour, key: 'lastHour', icon: Zap },
            { label: '오늘', val: stats.today, key: 'today', icon: Calendar },
            { label: '전체', val: stats.total, key: 'all', icon: Shield }
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setFilterDate(item.key)}
              className={`p-2.5 rounded-xl border text-left transition-all ${filterDate === item.key ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-gray-200 text-gray-600'}`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="text-[10px] font-bold opacity-80 uppercase">{item.label}</span>
                <item.icon className={`w-3 h-3 ${filterDate === item.key ? 'text-blue-100' : 'text-gray-400'}`} />
              </div>
              <div className="text-xl font-black leading-none">{item.val}</div>
            </button>
          ))}
        </div>

        {/* 필터 바 */}
        <div className="flex justify-between items-center mb-3 px-1">
          <div className="flex items-center gap-1 text-[11px] font-bold text-gray-500">
            <Clock className="w-3 h-3" />
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="bg-transparent border-none p-0 outline-none text-blue-600">
              <option value="newest">최신순</option>
              <option value="oldest">과거순</option>
            </select>
          </div>
          <span className="text-[11px] font-bold text-gray-400">{displayImages.length}개의 기록</span>
        </div>

        {/* 이미지 그리드: 모바일 2열 */}
        {displayImages.length === 0 ? (
          <div className="py-20 text-center bg-white rounded-2xl border-2 border-dashed border-gray-100">
            <Shield className="w-12 h-12 text-gray-200 mx-auto mb-2" />
            <p className="text-sm font-bold text-gray-400">데이터가 없습니다</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {displayImages.map((img) => (
              <div key={img.id} onClick={() => setSelectedImage(img)} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm active:scale-95 transition-all">
                <div className="aspect-[4/3] relative bg-gray-100">
                  <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  {Date.now() - img.timestamp.getTime() < 3600000 && (
                    <div className="absolute top-1.5 right-1.5 bg-red-600 text-white text-[8px] px-1.5 py-0.5 rounded-md font-black animate-pulse">NEW</div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-[10px] font-bold text-gray-700 truncate mb-1">{img.name}</p>
                  <p className="text-[9px] text-gray-400 font-medium mb-2">{formatTimestamp(img.timestamp)}</p>
                  <div className="flex gap-1.5">
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(img); }} className="flex-1 bg-gray-50 py-1.5 rounded-md flex justify-center border border-gray-100">
                      <Trash2 className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 상세 모달: 모바일 전면 */}
      {selectedImage && (
        <div className="fixed inset-0 bg-black/95 z-[100] flex flex-col pt-safe" onClick={() => setSelectedImage(null)}>
          <div className="p-4 flex justify-between items-center text-white">
            <div className="truncate pr-4">
              <p className="text-sm font-bold truncate">{selectedImage.name}</p>
              <p className="text-[10px] opacity-60">{formatTimestamp(selectedImage.timestamp)}</p>
            </div>
            <button className="text-2xl font-light">&times;</button>
          </div>
          <div className="flex-grow flex items-center justify-center p-2">
            <img src={selectedImage.url} className="max-w-full max-h-full object-contain shadow-2xl" alt="" />
          </div>
          <div className="p-4 grid grid-cols-2 gap-3" onClick={e => e.stopPropagation()}>
            <button onClick={() => window.open(selectedImage.url)} className="bg-white text-black py-3 rounded-xl font-bold text-sm flex justify-center items-center gap-2">
              <Download className="w-4 h-4" /> 다운로드
            </button>
            <button onClick={() => handleDelete(selectedImage)} className="bg-red-600 text-white py-3 rounded-xl font-bold text-sm flex justify-center items-center gap-2">
              <Trash2 className="w-4 h-4" /> 삭제하기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
