import type { InferencingEndpointResultTypes, InferencingEndpointTypes } from '../../EndpointTypes';

import { Row, Col, Form, FloatingLabel } from 'react-bootstrap';
import { type AdapterEndpoint, WithEndpoint, TitleCard } from '@dssg/odin-react';

import MonitorGraph from '../furnace/MonitorGraph';
import { floatingInputStyle } from '../../utils';

interface InferencingCardProps {
  endpoint: AdapterEndpoint<InferencingEndpointTypes>;
  name: string;
}

const EndpointSelect = WithEndpoint(Form.Select);

function InferencingCard(props: InferencingCardProps) {
    const {endpoint, name} = props;

    const results = endpoint?.data?.endpoint?.[name]?.results;
    const endpointPath = `endpoint/${name}`;

    const availableModels = endpoint?.data?.endpoint?.[name]?.model?.available || [];
    const firstFrame = results?.first_frame ?? 0;
    const graphs = Object.entries(results ?? {}).flatMap(([graphId, value]) => {
      // Skip first_frame and most_recent_frame, everything else is results to display
      if (typeof value === 'number') return [];

      const graph = value as InferencingEndpointResultTypes;
      if (graph.type === 'bitmap') {
        return [{ graphId, graph, series: [] }];
      }

      const series = Object.entries(graph.results ?? {});
      return series.length > 0 ? [{ graphId, graph, series }] : [];
    });
 
    return (

        <TitleCard title={`${name} Inference Details`}>
          <Row className='mb-3'>
            <Col>
              <Row className="mb-3">
                Details
                <Col xs={4}>
                  <FloatingLabel label="Select model">
                    <EndpointSelect
                      endpoint={endpoint}
                      fullpath={`${endpointPath}/model/select`}
                      style={floatingInputStyle}
                      value={endpoint?.data?.endpoint?.[name]?.model?.display_name || ''}
                    >
                      {availableModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </EndpointSelect>
                  </FloatingLabel>
                </Col>
                {/* <Col xs={4}>
                  <FloatingLabel label="# Predictions">
                    <Form.Control
                      plaintext
                      readOnly
                      style={floatingLabelStyle}
                      value={checkNullNoDp(inferenceResults?.num_predictions)}
                    />
                  </FloatingLabel>
                </Col>
                <Col xs={4}>
                  <FloatingLabel label="Last Frame #">
                    <Form.Control
                      plaintext
                      readOnly
                      style={floatingLabelStyle}
                      value={checkNullNoDp(inferenceResults?.last_frame_number)}
                    />
                  </FloatingLabel>
                </Col>
                <Col xs={4}>
                <FloatingLabel label="Avg Inf. Time">
                  <Form.Control
                    plaintext
                    readOnly
                    style={floatingLabelStyle}
                    value={checkNull(inferenceResults?.avg_inference_time_ms)}
                  />
                </FloatingLabel>
                </Col> */}
              </Row>
              <Row className='mt-3'>
                  Preprocessing (e.g. flatfield)
              </Row>
              <Row className="mt-3">
                Results values e.g. active classes
              </Row>
            </Col>
          </Row>
          <Row className="g-3">
            {graphs.map(({ graphId, graph, series }) => (
              <Col key={graphId} xs={12} xl={6}>
                {graph.type === 'bitmap' ? (
                  <div role="status">Image display not currently available.</div>
                ) : (
                  <MonitorGraph
                    endpoint={endpoint}
                    title={graph.graph_label || graphId}
                    plotTitle={graph.graph_label || graphId}
                    paths={series.map(([traceId]) =>
                      `${endpointPath}/results/${graphId}/results/${traceId}/data`)}
                    seriesNames={series.map(([traceId, trace]) => trace.label || traceId)}
                    xData={series.length > 0
                      ? Array.from(series[0][1].data, (_, index) => firstFrame + index)
                      : undefined}
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

