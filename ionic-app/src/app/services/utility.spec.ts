import { TestBed } from '@angular/core/testing';

import { Utility } from './utility';

describe('Utility', () => {
  let service: Utility;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Utility);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
