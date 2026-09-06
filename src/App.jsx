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

// 파일 크기 포맷팅 함수
const formatFileSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

// 타임스탬프 포맷팅 함수
const formatTimestamp = (timestamp) => {
  return timestamp.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const getDemoImage = () => ({
  id: 'demo-capture',
  key: 'demo-capture',
  url: '/demo-capture.png',
  name: 'demo-capture.png',
  timestamp: new Date('2026-09-07T12:00:00+09:00'),
  size: 'demo',
  isDemo: true,
});

// ✅ 전체 화면 로딩 오버레이
function FullScreenLoading({ message = '모니터링 데이터 확인중...' }) {
  return (
    <div className="fixed inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center z-[9999]">
      <div className="text-center px-6 w-full">
        <RefreshCw className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
        <p className="text-gray-700 text-lg font-semibold">{message}</p>
        <p className="text-gray-500 text-sm mt-2">잠시만 기다려주세요.</p>
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
  const [stats, setStats] = useState({
    lastHour: 0,
    today: 0,
    total: 0,
  });

  // S3 클라이언트 설정
  const s3Client = useMemo(
    () =>
      new S3Client({
        region: import.meta.env.VITE_AWS_REGION,
        credentials: {
          accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID,
          secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY,
        },
      }),
    []
  );

  const bucketName = import.meta.env.VITE_AWS_BUCKET_NAME;

  // S3에서 이미지 목록 가져오기
  const loadImagesFromS3 = async () => {
    setError(null);
    try {
      let ContinuationToken = undefined;
      const allItems = [];
      do {
        const command = new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken,
        });
        const response = await s3Client.send(command);
        if (response.Contents?.length) {
          allItems.push(...response.Contents);
        }
        ContinuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (ContinuationToken);

      if (!allItems.length) {
        setImages([getDemoImage()]);
        setStats({ lastHour: 0, today: 0, total: 1 });
        return;
      }

      const imagePromises = allItems
        .filter((item) => {
          const key = (item.Key || '').toLowerCase();
          return key.endsWith('.jpg') || key.endsWith('.jpeg');
        })
        .map(async (item) => {
          const getCommand = new GetObjectCommand({
            Bucket: bucketName,
            Key: item.Key,
          });
          const url = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
          return {
            id: item.Key,
            key: item.Key,
            url,
            name: item.Key.split('/').pop(),
            timestamp: item.LastModified,
            size: formatFileSize(item.Size),
          };
        });

      const imageList = await Promise.all(imagePromises);
      imageList.sort((a, b) => b.timestamp - a.timestamp);
      setImages([getDemoImage(), ...imageList]);

      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      const todayStart = new Date().setHours(0, 0, 0, 0);

      setStats({
        lastHour: imageList.filter((img) => img.timestamp.getTime() > oneHourAgo).length,
        today: imageList.filter((img) => img.timestamp.getTime() > todayStart).length,
        total: imageList.length + 1,
      });
    } catch (err) {
      console.error('S3 로딩 에러:', err);
      setError('S3에서 이미지를 불러오는데 실패했습니다.');
      setImages([getDemoImage()]);
      setStats({ lastHour: 0, today: 0, total: 1 });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async (img) => {
    try {
      const response = await fetch(img.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = img.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) { alert('다운로드 실패'); }
  };

  const handleDelete = async (img) => {
    if (img.isDemo) {
      alert('기본 데모 이미지는 삭제할 수 없습니다.');
      return;
    }
    if (!confirm(`"${img.name}" 파일을 삭제하시겠습니까?`)) return;
    try {
      setIsLoading(true);
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: img.key }));
      setSelectedImage(null);
      await loadImagesFromS3();
    } catch (e) { alert('삭제 실패'); }
    finally { setIsLoading(false); }
  };

  const deleteAllImages = async () => {
    if (!confirm('사진을 전체 삭제하시겠습니까?')) return;
    try {
      setIsDeletingAll(true);
      setIsLoading(true);
      for (const img of images.filter((item) => !item.isDemo)) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: img.key }));
      }
      alert('전체 삭제 완료');
      await loadImagesFromS3();
    } catch (e) { alert('전체 삭제 실패'); }
    finally { setIsDeletingAll(false); setIsLoading(false); }
  };

  useEffect(() => {
    loadImagesFromS3();
    if (refreshIntervalSec === 0) return;
    const interval = setInterval(() => {
      if (!isDeletingAll) loadImagesFromS3();
    }, refreshIntervalSec * 1000);
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

  if (isLoading && images.length === 0) return <FullScreenLoading message="모니터링 데이터 로딩 중..." />;

  return (
    <div className="min-h-screen bg-white text-gray-800 flex flex-col w-full overflow-x-hidden">
      {(isLoading || isDeletingAll) && images.length > 0 && (
        <FullScreenLoading message={isDeletingAll ? '사진 전체 삭제중...' : '모니터링 데이터 확인중...'} />
      )}

      {/* 헤더 */}
      <header className="bg-white shadow-lg border-b border-blue-200 sticky top-0 z-40">
        <div className="px-4 md:px-12 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-blue-600 p-2 rounded-lg shadow-md shrink-0">
                <Shield className="w-6 h-6 md:w-7 md:h-7 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-3xl font-extrabold text-blue-700 tracking-tight whitespace-nowrap">
                  공마고의 도둑들
                </h1>
                <p className="text-[10px] md:text-sm text-gray-500 font-medium whitespace-nowrap">
                  REFRIGERATOR ACCESS LOGS MONITORING
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 md:gap-4 overflow-x-auto no-scrollbar pb-1 md:pb-0">
              <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 bg-white text-xs md:text-sm shrink-0">
                <Settings className="w-4 h-4 text-gray-600" />
                <span className="hidden sm:inline text-gray-700 font-medium">자동 새로고침:</span>
                <select
                  value={refreshIntervalSec}
                  onChange={(e) => setRefreshIntervalSec(Number(e.target.value))}
                  className="bg-transparent outline-none cursor-pointer font-bold text-blue-600"
                >
                  <option value={0}>정지</option>
                  <option value={5}>5초</option>
                  <option value={10}>10초</option>
                  <option value={15}>15초</option>
                  <option value={30}>30초</option>
                </select>
              </div>

              <button onClick={deleteAllImages} className="whitespace-nowrap flex items-center gap-2 bg-red-600 text-white px-4 py-2.5 rounded-lg shadow-md hover:bg-red-700 font-semibold text-xs md:text-sm transition-all active:scale-95">
                <Trash2 className="w-4 h-4" /> 전체 삭제
              </button>

              <button onClick={() => loadImagesFromS3()} className="whitespace-nowrap flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg shadow-md hover:bg-blue-700 font-semibold text-xs md:text-sm transition-all active:scale-95">
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                <span className="hidden xs:inline">새로고침</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="p-4 md:p-8 w-full flex-grow max-w-[2000px] mx-auto">
        {/* 경고 배너 */}
        <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-3 md:p-4 mb-6 flex items-start gap-3 w-full shadow-sm">
          <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-yellow-800 font-bold text-sm md:text-lg">경고: 용도 외 사용금지</p>
            <p className="text-gray-600 text-[11px] md:text-sm">
              본 시스템의 기록은 모니터링 될 수 있으며, 불법적 사용 시 처벌받을 수 있습니다.
            </p>
          </div>
        </div>

        {/* 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-8">
          {[
            { label: '최근 1시간 (ALERT)', val: stats.lastHour, key: 'lastHour', icon: Zap, sub: 'LAST 60 MINUTES' },
            { label: '오늘 기록 (TODAY)', val: stats.today, key: 'today', icon: Calendar, sub: 'TODAY RECORDS' },
            { label: '전체 기록 (TOTAL)', val: stats.total, key: 'all', icon: Shield, sub: 'ALL TIME RECORDS' }
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setFilterDate(item.key)}
              className={`bg-white border rounded-xl p-4 md:p-6 shadow-lg text-left transition-all ${
                filterDate === item.key ? 'border-blue-600 ring-4 ring-blue-100' : 'border-gray-200 hover:border-blue-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-600 text-[10px] md:text-sm font-medium">{item.label}</span>
                <item.icon className={`w-5 h-5 ${filterDate === item.key ? 'text-blue-600' : 'text-gray-400'}`} />
              </div>
              <div className="text-2xl md:text-4xl font-extrabold text-blue-700 mb-1">{item.val}건</div>
              <div className="text-gray-400 text-[8px] md:text-xs font-semibold">{item.sub}</div>
            </button>
          ))}
        </div>

        {/* 필터 바 */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 md:p-4 mb-6 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-500" />
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="text-xs md:text-sm font-bold text-gray-700 bg-transparent outline-none cursor-pointer">
              <option value="newest">최신순 정렬</option>
              <option value="oldest">오래된순 정렬</option>
              <option value="name">파일명순 정렬</option>
            </select>
          </div>
          <div className="text-[10px] md:text-sm text-gray-500 font-semibold">
            표시 중: <span className="text-blue-600">{displayImages.length}개</span>
          </div>
        </div>

        {/* 이미지 그리드 */}
        {displayImages.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center shadow-md">
            <Shield className="w-16 h-16 text-gray-200 mx-auto mb-4" />
            <p className="text-gray-500 font-bold">기록된 데이터가 없습니다.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-5">
            {displayImages.map((img) => (
              <div key={img.id} onClick={() => setSelectedImage(img)} className="bg-white border rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-all cursor-pointer group active:scale-95 md:active:scale-100">
                <div className="aspect-video bg-gray-100 relative">
                  <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  {Date.now() - img.timestamp.getTime() < 3600000 && (
                    <div className="absolute top-2 right-2 bg-red-600 text-white text-[8px] md:text-xs px-2 py-0.5 rounded-full font-bold animate-pulse shadow-md">ALERT</div>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-[10px] md:text-sm font-mono font-bold text-gray-800 truncate mb-1">{img.name}</p>
                  <p className="text-[9px] md:text-xs text-gray-400 mb-3">{formatTimestamp(img.timestamp)}</p>
                  <div className="flex gap-2">
                    <button onClick={(e) => { e.stopPropagation(); handleDownload(img); }} className="flex-1 bg-gray-50 py-2 rounded-lg flex justify-center border border-gray-200">
                      <Download className="w-3.5 h-3.5 text-gray-600" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(img); }} className="bg-red-500 px-3 py-2 rounded-lg flex justify-center shadow-sm">
                      <Trash2 className="w-3.5 h-3.5 text-white" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 이미지 상세 모달 */}
      {selectedImage && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-[100]" onClick={() => setSelectedImage(null)}>
          <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[95vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <div className="truncate pr-4">
                <h3 className="font-bold text-sm md:text-lg truncate">{selectedImage.name}</h3>
                <p className="text-[10px] md:text-xs text-gray-400">{formatTimestamp(selectedImage.timestamp)} · {selectedImage.size}</p>
              </div>
              <button onClick={() => setSelectedImage(null)} className="text-2xl p-2 text-gray-400 hover:text-black">&times;</button>
            </div>
            <div className="flex-grow bg-gray-100 overflow-hidden flex items-center justify-center">
              <img src={selectedImage.url} className="max-w-full max-h-full object-contain" alt="" />
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <button onClick={() => handleDownload(selectedImage)} className="bg-blue-600 text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2">
                <Download className="w-4 h-4" /> 다운로드
              </button>
              <button onClick={() => handleDelete(selectedImage)} className="bg-red-600 text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2">
                <Trash2 className="w-4 h-4" /> 삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
