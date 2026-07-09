import { TestBed } from '@angular/core/testing';

import { SharedApi } from './shared-api';

describe('SharedApi', () => {
  let service: SharedApi;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SharedApi);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
