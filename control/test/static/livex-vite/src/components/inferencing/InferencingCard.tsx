import type {
  InferencingEndpointResultTypes,
  InferencingEndpointTypes,
  InferencingLineResult,
} from '../../EndpointTypes';

import { Row, Col, Form, FloatingLabel, ProgressBar, Spinner } from 'react-bootstrap';
import { type AdapterEndpoint, useAdapterEndpoint, EndpointSelect, EndpointInput, EndpointButton, TitleCard } from '@dssg/odin-react';
import { useEffect, useRef, useState } from 'react';

import MonitorGraph from '../furnace/MonitorGraph';
import { floatingLabelStyle, checkNull, checkNullNoDp } from '../../utils';

interface InferencingCardProps {
  endpoint: AdapterEndpoint<InferencingEndpointTypes>;
  endpoint_url: string;
  name: string;
}

interface BitmapImageProps {
  endpoint_url: string;
  endpoint_name: string;
  graph_name: string;
  alt: string;
}

function BitmapImage({ endpoint_url, endpoint_name, graph_name, alt }: BitmapImageProps) {
  const [src, setSrc] = useState<string>();
  const imageEndpoint = useAdapterEndpoint<InferencingEndpointTypes>(
    'inferencing', endpoint_url, 1000
  );
  const getRef = useRef(imageEndpoint.get);
  getRef.current = imageEndpoint.get;
  const graph = imageEndpoint.data?.endpoint?.[endpoint_name]?.results?.[graph_name];
  const isBitmapGraph = typeof graph !== 'number' && graph?.type === 'bitmap';
  const path = `endpoint/${endpoint_name}/results/${graph_name}/results/_image`;

  useEffect(() => {
    if (!isBitmapGraph) {
      setSrc(undefined);
      return;
    }

    let active = true;
    let requestPending = false;
    let objectUrl: string | undefined;

    const updateImage = async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const image = await getRef.current<Blob>(path, { responseType: 'blob' });
        if (!active || image.size === 0) return;

        const nextUrl = URL.createObjectURL(image);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = nextUrl;
        setSrc(nextUrl);
      } catch {
        return;
      } finally {
        requestPending = false;
      }
    };

    void updateImage();
    const intervalId = window.setInterval(() => void updateImage(), 1000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isBitmapGraph, path]);

  return src ? (
    <img src={src} alt={alt} style={{ maxWidth: '100%', maxHeight: '70vh' }} />
  ) : (
    <div role="status">Waiting for image.</div>
  );
}

type InferenceGraph = {
  graphId: string;
  graph: InferencingEndpointResultTypes;
  series: Array<[string, InferencingLineResult['results'][string]]>;
};

type FlatfieldInputMode = 'number' | 'first_n';

function InferencingCard(props: InferencingCardProps) {
    const {endpoint, endpoint_url, name} = props;
    const [flatfieldInputMode, setFlatfieldInputMode] = useState<FlatfieldInputMode>('first_n');

    const datapath = endpoint?.data?.endpoint?.[name];
    const results = endpoint?.data?.endpoint?.[name]?.results;
    const endpointPath = `endpoint/${name}`;
    const flatfieldStatus = datapath?.flatfield;
    const flatfieldMode = flatfieldStatus?.mode ?? 'unknown';
    const capture = flatfieldStatus?.capture;
    const captureProgress = capture && capture.need > 0
      ? Math.min(100, capture.have / capture.need * 100)
      : 0;
    const flatfieldLoading = Boolean(flatfieldStatus?.ticket) &&
      flatfieldStatus?.state !== 'capturing' &&
      flatfieldStatus?.state !== 'ready' &&
      flatfieldStatus?.state !== 'none' &&
      !flatfieldStatus?.error;

    const availableModels = endpoint?.data?.endpoint?.[name]?.model?.available || [];
    const graphs = Object.entries(results ?? {}).flatMap<InferenceGraph>(([graphId, value]) => {
      // Skip summary numbers and null graph entries seen while models are swapping.
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];

      const graph = value as InferencingEndpointResultTypes;
      if (graph.type === 'bitmap') {
        return [{ graphId, graph, series: [] }];
      }

      const series = Object.entries(graph.results ?? {});
      return series.length > 0 ? [{ graphId, graph, series }] : [];
    });
 
    return (

        <TitleCard title={`${name} Inference Details`}>
          <Row >
            <Col>
              <Row>
                Details
                <Col xs={4}>
                  <FloatingLabel label="Select model">
                    <EndpointSelect
                      endpoint={endpoint}
                      fullpath={`${endpointPath}/model/select`}
                      value={endpoint?.data?.endpoint?.[name]?.model?.status?.display_name || ''}
                    >
                      {availableModels.map((model) => (
                        <option key={model.display_name} value={model.name}>
                          {model.display_name}
                        </option>
                      ))}
                    </EndpointSelect>
                  </FloatingLabel>
                </Col>
              </Row>
              <Row className="mt-3 g-3">
                <Col xs={12} md={4}>
                  <FloatingLabel label="Select flatfield mode">
                    <Form.Select
                      value={flatfieldInputMode}
                      onChange={(event) =>
                        setFlatfieldInputMode(event.target.value as FlatfieldInputMode)}
                    >
                      <option value="number">Experiment file</option>
                      <option value="first_n">First N frames</option>
                    </Form.Select>
                  </FloatingLabel>
                </Col>
                {flatfieldInputMode === 'number' && (
                  <Col xs={12} md={4}>
                    <FloatingLabel label="Experiment number">
                      <EndpointInput
                        endpoint={endpoint}
                        fullpath={`${endpointPath}/flatfield/number`}
                        type="number"
                        min={0}
                      />
                    </FloatingLabel>
                  </Col>
                )}
                {flatfieldInputMode === 'first_n' && (
                  <Col xs={12} md={4}>
                    <FloatingLabel label="Frames to average">
                      <EndpointInput
                        endpoint={endpoint}
                        fullpath={`${endpointPath}/flatfield/n`}
                        type="number"
                        min={1}
                      />
                    </FloatingLabel>
                  </Col>
                )}
                <Col xs="auto">
                  <EndpointButton
                    endpoint={endpoint}
                    fullpath={`${endpointPath}/flatfield/enabled`}
                    value={!datapath?.flatfield?.enabled}
                    variant={datapath?.flatfield?.enabled ? 'warning' : 'success'}
                  >
                    {datapath?.flatfield?.enabled ? 'Disable flatfield' : 'Enable flatfield'}
                  </EndpointButton>
                </Col>
                {flatfieldStatus?.state === 'capturing' && capture && (
                  <Col xs={12}>
                    <div className="small mb-1">
                      Capturing Flatfield: {capture.have}/{capture.need}
                    </div>
                    <ProgressBar
                      now={captureProgress}
                      aria-label="Flatfield capture progress"
                    />
                  </Col>
                )}
                {flatfieldLoading && (
                  <Col xs={12} role="status" className="small">
                    <Spinner animation="border" size="sm" className="me-2" />
                    Loading Flatfield...
                  </Col>
                )}
                {flatfieldStatus?.error && (
                  <Col xs={12} role="alert" className="small text-danger">
                    Flatfield error: {flatfieldStatus.error}
                  </Col>
                )}
              </Row>
              <Row className="mt-3 g-3">
                <Col xs={6} md={3}>
                  <FloatingLabel label="Flatfield mode">
                    <Form.Control
                      plaintext
                      readOnly
                      style={floatingLabelStyle}
                      value={flatfieldMode === 'number'
                        ? 'Experiment file'
                        : flatfieldMode === 'first_n'
                          ? 'First N frames'
                          : flatfieldMode}
                    />
                  </FloatingLabel>
                </Col>
                <Col xs={6} md={3}>
                  <FloatingLabel label="Flatfield enabled">
                    <Form.Control
                      plaintext
                      readOnly
                      style={floatingLabelStyle}
                      value={datapath?.flatfield?.enabled == null
                        ? 'Unknown'
                        : String(datapath.flatfield.enabled)}
                    />
                  </FloatingLabel>
                </Col>
                <Col xs={6} md={3}>
                  <FloatingLabel label="Flatfield loaded">
                    <Form.Control
                      plaintext
                      readOnly
                      style={floatingLabelStyle}
                      value={datapath?.flatfield?.loaded == null
                        ? 'Unknown'
                        : String(datapath.flatfield.loaded)}
                    />
                  </FloatingLabel>
                </Col>
                <Col xs={6} md={3}>
                  <FloatingLabel label="Flatfield source">
                    <Form.Control
                      plaintext
                      readOnly
                      style={floatingLabelStyle}
                      value={datapath?.flatfield?.source ?? 'Unknown'}
                    />
                  </FloatingLabel>
                </Col>
              </Row>
              <Row className="mt-3">
                <Col xs={4}>
                  <FloatingLabel label="Mean inference time (ms)">
                    <Form.Control
                      plaintext
                      readOnly
                      style={floatingLabelStyle}
                      value={checkNull(datapath?.stats?.mean_infer_ms)}
                    />
                  </FloatingLabel>
                </Col>
                <Col xs={4}>
                  <FloatingLabel label="Total frames seen">
                    <Form.Control
                      plaintext
                      readOnly
                      style={floatingLabelStyle}
                      value={checkNullNoDp(datapath?.stats?.frames_seen)}
                    />
                  </FloatingLabel>
                </Col>
              </Row>
            </Col>
          </Row>
          <Row className="mt-3 g-3">
            {graphs.map(({ graphId, graph, series }) => (
              <Col key={graphId} xs={12} xl={6}>
                {graph.type === 'bitmap' ? (
                  <BitmapImage
                    endpoint_url={endpoint_url}
                    endpoint_name={name}
                    graph_name={graphId}
                    alt={`${graph.graph_label || graphId} frame ${graph.frame_number ?? ''}`}
                  />
                ) : (
                  <MonitorGraph
                    endpoint={endpoint}
                    title={graph.graph_label || graphId}
                    plotTitle={graph.graph_label || graphId}
                    paths={series.map(([traceId]) =>
                      `${endpointPath}/results/${graphId}/results/${traceId}/data`)}
                    seriesNames={series.map(([traceId, trace]) => trace.label || traceId)}
                    xData={graph.frame_number}
                    xLabel={graph.x_label}
                    yLabel={graph.y_label}
                    axisLimit={graph.axis_limit}
                    type={graph.type}
                    showTitleCard={false}
                  />
                )}
              </Col>
            ))}
          </Row>
        </TitleCard>
    )
}

export default InferencingCard;

